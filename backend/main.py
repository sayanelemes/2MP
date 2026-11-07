"""FastAPI: маршруты /api, CORS, раздача frontend/ с /."""
import hashlib
import json
from contextlib import asynccontextmanager, closing
from typing import Any
from urllib.parse import quote

from fastapi import Body, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analytics, appeals, audio, checklists, config, datasets, db, evaluator, replay


@asynccontextmanager
async def lifespan(app):
    db.init()
    checklists.seed_if_empty()
    yield


app = FastAPI(title="CQA", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    text = "; ".join(f"{'.'.join(str(p) for p in e['loc'] if p != 'body')}: {e['msg']}" for e in exc.errors())
    return JSONResponse({"detail": text}, status_code=422)


class ImportIn(BaseModel):
    group_id: str


class EvaluationsIn(BaseModel):
    group_id: str
    conversation_ids: list[str] | None = None
    all: bool = False
    checklist_id: str
    version: int | None = None
    force: bool = False


class AppealIn(BaseModel):
    evaluation_id: int
    criterion_id: str
    comment: str
    created_by: str | None = None


class ReplaySuggestIn(BaseModel):
    criterion_id: str


class ReplayIn(BaseModel):
    criterion_id: str
    turn_id: str
    text: str


class DecisionIn(BaseModel):
    decision: str
    new_answer: int | float | str | None = None
    decision_reason: str
    decided_by: str | None = None


# --- диалоги ---

@app.post("/api/datasets/import")
def import_dataset(body: ImportIn):
    return datasets.import_group(body.group_id.strip())


@app.post("/api/conversations/upload")
async def upload(request: Request, group_id: str = "UPLOAD"):
    try:
        payload = await request.json()
    except ValueError:
        raise HTTPException(422, "тело запроса — не JSON")
    return {"imported": datasets.save_records(group_id, datasets.extract_records(payload))}


def _audio_path(c):
    return f"/api/audio/{quote(c['group_id'], safe='')}/{quote(c['conversation_id'], safe='')}" \
        if c["audio_url"] else None


@app.get("/api/conversations")
def list_conversations(group_id: str | None = None, channel: str | None = None, language: str | None = None,
                       status: str | None = None, checklist_id: str | None = None):
    where, args = [], []
    for field, value in (("group_id", group_id), ("channel", channel), ("language", language)):
        if value:
            where.append(f"{field}=?")
            args.append(value)
    with closing(db.connect()) as conn:
        convs = db.rows(conn, "SELECT * FROM conversations" + (" WHERE " + " AND ".join(where) if where else ""), args)
        latest = {(e["group_id"], e["conversation_id"]): e for e in db.latest_evaluations(conn, group_id, checklist_id)}
        open_appeals = {r["evaluation_id"]: r["n"] for r in db.rows(
            conn, "SELECT evaluation_id, COUNT(*) n FROM appeals WHERE status='open' GROUP BY evaluation_id")}
    out = []
    for c in convs:
        transcript = json.loads(c["transcript_json"])
        times = [u["t"] for u in transcript if u["t"] is not None]
        ev = latest.get((c["group_id"], c["conversation_id"]))
        item = {
            "group_id": c["group_id"], "conversation_id": c["conversation_id"], "channel": c["channel"],
            "language": c["language"], "turn_count": len(transcript), "duration": max(times) if times else None,
            "audio_path": _audio_path(c),
            "evaluation_id": ev and ev["id"], "status": ev["status"] if ev else "new",
            "ai_total": ev and ev["ai_total"], "final_total": ev and ev["final_total"],
            "critical_flag": bool(ev and ev["final_critical_flag"]),
            "open_appeals": open_appeals.get(ev["id"], 0) if ev else 0,
        }
        if not status or item["status"] == status:
            out.append(item)
    out.sort(key=lambda i: (not i["critical_flag"], i["status"] != "needs_review", i["final_total"] is None,
                            i["final_total"] or 0, i["conversation_id"]))
    return out


@app.get("/api/conversations/{group_id}/{conversation_id}")
def get_conversation(group_id: str, conversation_id: str):
    with closing(db.connect()) as conn:
        c = db.get_conversation(conn, group_id, conversation_id)
        if not c:
            raise HTTPException(404, "диалог не найден")
        c["evaluations"] = db.rows(
            conn, "SELECT id, checklist_id, checklist_version, model, status, ai_total, final_total,"
                  " ai_critical_flag, final_critical_flag, created_at FROM evaluations"
                  " WHERE group_id=? AND conversation_id=? ORDER BY id DESC", (group_id, conversation_id))
    times = [u["t"] for u in c["transcript"] if u["t"] is not None]
    c["duration"] = max(times) if times else None
    c["audio_path"] = _audio_path(c)
    del c["audio_url"]
    return c


@app.get("/api/audio/{group_id}/{conversation_id}")
async def get_audio(group_id: str, conversation_id: str, range: str | None = Header(None)):
    return await audio.stream(group_id, conversation_id, range)


# --- чек-листы ---

@app.get("/api/checklists")
def list_checklists():
    return checklists.latest_all()


@app.get("/api/checklists/{checklist_id}/versions")
def checklist_versions(checklist_id: str):
    return checklists.versions(checklist_id)


@app.get("/api/checklists/{checklist_id}/versions/{version}")
def checklist_version(checklist_id: str, version: int):
    return checklists.get(checklist_id, version)


@app.post("/api/checklists")
def create_checklist(body: Any = Body(...)):
    return checklists.create(body)


@app.put("/api/checklists/{checklist_id}")
def update_checklist(checklist_id: str, body: Any = Body(...)):
    return checklists.new_version(checklist_id, body)


# --- оценки ---

@app.post("/api/evaluations")
def create_evaluations(body: EvaluationsIn):
    model, prompt_version = evaluator.current_model(), evaluator.PROMPT_VERSION
    with closing(db.connect()) as conn:
        cl = db.get_checklist(conn, body.checklist_id, body.version)
        if not cl:
            raise HTTPException(404, "чек-лист или версия не найдены")
        if body.all:
            convs = db.rows(conn, "SELECT conversation_id, content_hash FROM conversations WHERE group_id=?",
                            (body.group_id,))
        else:
            ids = body.conversation_ids or []
            convs = db.rows(conn, f"SELECT conversation_id, content_hash FROM conversations WHERE group_id=?"
                                  f" AND conversation_id IN ({','.join('?' * len(ids))})", [body.group_id, *ids])
            missing = set(ids) - {c["conversation_id"] for c in convs}
            if missing:
                raise HTTPException(404, f"диалоги не найдены: {', '.join(sorted(missing))}")
    if not convs:
        raise HTTPException(422, "нет диалогов для оценки")
    planned = []
    for c in convs:
        key = hashlib.sha256(
            f"{c['content_hash']}|{cl['id']}|{cl['version']}|{model}|{prompt_version}".encode()).hexdigest()
        planned.append((c["conversation_id"], key, None if body.force else db.find_cached_evaluation(key)))
    reused = sum(1 for p in planned if p[2])
    new_ids = []
    with closing(db.connect()) as conn, conn:
        job_id = conn.execute("INSERT INTO jobs(total, done, failed, status, created_at) VALUES (?,?,0,?,?)",
                              (len(planned), reused, "done" if reused == len(planned) else "queued",
                               db.now())).lastrowid
        for conversation_id, key, cached in planned:
            if not cached:
                new_ids.append(conn.execute(
                    "INSERT INTO evaluations(job_id, group_id, conversation_id, checklist_id, checklist_version,"
                    " model, prompt_version, cache_key, status, created_at) VALUES (?,?,?,?,?,?,?,?,'queued',?)",
                    (job_id, body.group_id, conversation_id, cl["id"], cl["version"], model, prompt_version, key,
                     db.now())).lastrowid)
    if new_ids:
        evaluator.start_job(job_id, new_ids)
    return {"job_id": job_id, "total": len(planned), "reused": reused}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: int):
    with closing(db.connect()) as conn:
        job = db.row(conn, "SELECT * FROM jobs WHERE id=?", (job_id,))
    if not job:
        raise HTTPException(404, "задание не найдено")
    return job


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: int):
    job = get_job(job_id)
    if job["status"] != "done":
        evaluator.stop_job(job_id)
    return job


@app.get("/api/evaluations/{evaluation_id}")
def get_evaluation(evaluation_id: int):
    with closing(db.connect()) as conn:
        ev = db.get_evaluation(conn, evaluation_id)
    if not ev:
        raise HTTPException(404, "оценка не найдена")
    return ev


@app.post("/api/evaluations/{evaluation_id}/replay/suggest")
def replay_suggest(evaluation_id: int, body: ReplaySuggestIn):
    return replay.suggest(evaluation_id, body.criterion_id)


@app.post("/api/evaluations/{evaluation_id}/replay")
def replay_check(evaluation_id: int, body: ReplayIn):
    return replay.replay(evaluation_id, body.criterion_id, body.turn_id, body.text)


# --- апелляции и аналитика ---

@app.post("/api/appeals")
def create_appeal(body: AppealIn):
    return appeals.create(body.evaluation_id, body.criterion_id, body.comment, body.created_by)


@app.get("/api/appeals")
def list_appeals(status: str | None = None):
    return appeals.queue(status)


@app.post("/api/appeals/{appeal_id}/decision")
def decide_appeal(appeal_id: int, body: DecisionIn):
    return appeals.decide(appeal_id, body.decision, body.new_answer, body.decision_reason, body.decided_by)


@app.get("/api/analytics")
def get_analytics(group_id: str | None = None, checklist_id: str | None = None):
    return analytics.summary(group_id, checklist_id)


app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True, check_dir=False), name="frontend")
