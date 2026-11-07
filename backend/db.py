"""SQLite: схема, подключение и функции доступа. Нижние четыре функции — контракт для evaluator.py."""
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

from . import config, scoring

SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations(
  group_id TEXT NOT NULL, conversation_id TEXT NOT NULL, channel TEXT, language TEXT,
  transcript_json TEXT NOT NULL, audio_url TEXT, content_hash TEXT NOT NULL, imported_at TEXT NOT NULL,
  PRIMARY KEY(group_id, conversation_id));
CREATE TABLE IF NOT EXISTS checklists(
  id TEXT NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL, criteria_json TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE IF NOT EXISTS jobs(
  id INTEGER PRIMARY KEY, total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evaluations(
  id INTEGER PRIMARY KEY, job_id INTEGER REFERENCES jobs(id), group_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL, checklist_id TEXT NOT NULL, checklist_version INTEGER NOT NULL,
  model TEXT, prompt_version TEXT, cache_key TEXT, status TEXT NOT NULL, error TEXT,
  ai_total REAL, final_total REAL, ai_critical_flag INTEGER NOT NULL DEFAULT 0,
  final_critical_flag INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  FOREIGN KEY(group_id, conversation_id) REFERENCES conversations(group_id, conversation_id),
  FOREIGN KEY(checklist_id, checklist_version) REFERENCES checklists(id, version));
CREATE INDEX IF NOT EXISTS evaluations_conv ON evaluations(group_id, conversation_id, checklist_id);
CREATE INDEX IF NOT EXISTS evaluations_cache ON evaluations(cache_key);
CREATE TABLE IF NOT EXISTS criterion_results(
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id), criterion_id TEXT NOT NULL,
  ai_answer TEXT, final_answer TEXT, reason TEXT, evidence_json TEXT, checked_range_json TEXT,
  base_weight REAL, effective_weight REAL, points REAL, suggestion TEXT, PRIMARY KEY(evaluation_id, criterion_id));
CREATE TABLE IF NOT EXISTS appeals(
  id INTEGER PRIMARY KEY, evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  criterion_id TEXT NOT NULL, comment TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT,
  created_at TEXT NOT NULL, decision TEXT, new_answer TEXT, decision_reason TEXT,
  decided_by TEXT, decided_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS appeals_one_open ON appeals(evaluation_id, criterion_id) WHERE status = 'open';
-- кэш учебной переигровки; официальную оценку не трогает
CREATE TABLE IF NOT EXISTS replays(
  cache_key TEXT PRIMARY KEY, evaluation_id INTEGER NOT NULL, kind TEXT NOT NULL, turn_id TEXT, text TEXT,
  model TEXT, prompt_version TEXT, response_json TEXT NOT NULL, created_at TEXT NOT NULL);
-- ai_* после записи не меняются никогда
CREATE TRIGGER IF NOT EXISTS evaluations_ai_frozen BEFORE UPDATE OF ai_total, ai_critical_flag ON evaluations
  WHEN OLD.status NOT IN ('queued', 'running') BEGIN SELECT RAISE(ABORT, 'ai_* неизменны'); END;
CREATE TRIGGER IF NOT EXISTS criterion_results_ai_frozen BEFORE UPDATE OF ai_answer ON criterion_results
  BEGIN SELECT RAISE(ABORT, 'ai_answer неизменен'); END;
"""


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect():
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init():
    with closing(connect()) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(SCHEMA)
        if "suggestion" not in {r["name"] for r in conn.execute("PRAGMA table_info(criterion_results)")}:
            conn.execute("ALTER TABLE criterion_results ADD COLUMN suggestion TEXT")  # старые базы: колонка появилась позже


def rows(conn, sql, args=()):
    return [dict(r) for r in conn.execute(sql, args)]


def row(conn, sql, args=()):
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


def get_checklist(conn, checklist_id, version=None):
    """Версия чек-листа (последняя, если version не задана) или None."""
    if version is None:
        r = row(conn, "SELECT * FROM checklists WHERE id=? ORDER BY version DESC LIMIT 1", (checklist_id,))
    else:
        r = row(conn, "SELECT * FROM checklists WHERE id=? AND version=?", (checklist_id, version))
    if r:
        r["criteria"] = json.loads(r.pop("criteria_json"))
    return r


def get_conversation(conn, group_id, conversation_id):
    r = row(conn, "SELECT * FROM conversations WHERE group_id=? AND conversation_id=?", (group_id, conversation_id))
    if r:
        r["transcript"] = json.loads(r.pop("transcript_json"))
    return r


def latest_evaluations(conn, group_id=None, checklist_id=None):
    """Последняя оценка каждого диалога (по выбранному чек-листу, если задан)."""
    where = " AND ".join(f for f, v in (("group_id=?", group_id), ("checklist_id=?", checklist_id)) if v)
    args = [v for v in (group_id, checklist_id) if v]
    return rows(conn, "SELECT * FROM evaluations WHERE id IN (SELECT MAX(id) FROM evaluations"
                      f" {'WHERE ' + where if where else ''} GROUP BY group_id, conversation_id)", args)


def get_evaluation(conn, evaluation_id):
    ev = row(conn, "SELECT * FROM evaluations WHERE id=?", (evaluation_id,))
    if ev is None:
        return None
    cl = get_checklist(conn, ev["checklist_id"], ev["checklist_version"])
    stored = {r["criterion_id"]: r for r in
              rows(conn, "SELECT * FROM criterion_results WHERE evaluation_id=?", (evaluation_id,))}
    results = []
    for c in cl["criteria"]:
        r = stored.get(c["id"])
        if r:
            results.append({
                "criterion_id": c["id"], "section": c.get("section"), "title": c["title"], "type": c["type"],
                "is_critical": bool(c.get("is_critical")),
                "ai_answer": json.loads(r["ai_answer"]), "final_answer": json.loads(r["final_answer"]),
                "base_weight": r["base_weight"], "effective_weight": r["effective_weight"], "points": r["points"],
                "reason": r["reason"], "evidence": json.loads(r["evidence_json"] or "[]"),
                "checked_range": json.loads(r["checked_range_json"] or "null"),
                "suggestion": r.get("suggestion") or "",
            })
    sections = []
    if results and len(results) == len(cl["criteria"]):
        sections = scoring.compute(cl["criteria"], {r["criterion_id"]: r["final_answer"] for r in results})["sections"]
    appeals = rows(conn, "SELECT * FROM appeals WHERE evaluation_id=? ORDER BY id", (evaluation_id,))
    for a in appeals:
        a["new_answer"] = json.loads(a["new_answer"]) if a["new_answer"] is not None else None
    ev["ai_critical_flag"] = bool(ev["ai_critical_flag"])
    ev["final_critical_flag"] = bool(ev["final_critical_flag"])
    return {**ev, "checklist_name": cl["name"], "sections": sections, "results": results, "appeals": appeals}


# --- контракт для evaluator.py (человек 2) ---

def get_evaluation_context(evaluation_id):
    with closing(connect()) as conn:
        ev = row(conn, "SELECT * FROM evaluations WHERE id=?", (evaluation_id,))
        if ev is None:
            raise ValueError(f"оценка {evaluation_id} не найдена")
        conv = get_conversation(conn, ev["group_id"], ev["conversation_id"])
        conv.pop("audio_url")
        return {"conversation": conv, "checklist": get_checklist(conn, ev["checklist_id"], ev["checklist_version"])}


def find_cached_evaluation(cache_key):
    with closing(connect()) as conn:
        r = row(conn, "SELECT id FROM evaluations WHERE cache_key=? AND status='done' ORDER BY id DESC LIMIT 1",
                (cache_key,))
        return r and r["id"]


def set_evaluation_running(evaluation_id):
    with closing(connect()) as conn, conn:
        conn.execute("UPDATE evaluations SET status='running' WHERE id=? AND status='queued'", (evaluation_id,))
        conn.execute("UPDATE jobs SET status='running' WHERE status='queued' AND id="
                     "(SELECT job_id FROM evaluations WHERE id=?)", (evaluation_id,))


def save_evaluation_result(evaluation_id, results, model, prompt_version, status, error=None):
    with closing(connect()) as conn, conn:
        ev = row(conn, "SELECT * FROM evaluations WHERE id=?", (evaluation_id,))
        if ev is None:
            raise ValueError(f"оценка {evaluation_id} не найдена")
        if ev["status"] not in ("queued", "running"):
            raise ValueError(f"оценка {evaluation_id} уже сохранена")
        criteria = get_checklist(conn, ev["checklist_id"], ev["checklist_version"])["criteria"]
        comp = None
        if results:
            by_id = {r["criterion_id"]: r for r in results}
            try:
                comp = scoring.compute(criteria, {k: r["answer"] for k, r in by_id.items()})
            except ValueError as e:
                status, error = "error", f"некорректный результат: {e}"
        if comp:
            for pc in comp["per_criterion"]:
                r = by_id[pc["criterion_id"]]
                answer = json.dumps(r["answer"])
                conn.execute(
                    "INSERT INTO criterion_results VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (evaluation_id, pc["criterion_id"], answer, answer, r.get("reason"),
                     json.dumps(r.get("evidence") or [], ensure_ascii=False),
                     json.dumps(r.get("checked_range"), ensure_ascii=False),
                     pc["base_weight"], pc["effective_weight"], pc["points"], r.get("suggestion") or ""))
        total = comp["total"] if comp else None
        flag = bool(comp and comp["critical_flag"])
        conn.execute(
            "UPDATE evaluations SET model=?, prompt_version=?, status=?, error=?, ai_total=?, final_total=?,"
            " ai_critical_flag=?, final_critical_flag=? WHERE id=?",
            (model, prompt_version, status, error, total, total, flag, flag, evaluation_id))
        ok = status != "error"
        conn.execute("UPDATE jobs SET done=done+?, failed=failed+? WHERE id=?", (int(ok), int(not ok), ev["job_id"]))
        conn.execute("UPDATE jobs SET status='done' WHERE id=? AND done+failed>=total", (ev["job_id"],))
