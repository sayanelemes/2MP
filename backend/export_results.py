"""Выгрузка оценок в формат сдачи (results.json, schema 1.0): python -m backend.export_results DEV dev "Команда"."""
import argparse
import json
import sys
from contextlib import closing
from pathlib import Path

from . import db

CODES = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]
CHECKLIST_ORDER = ["c01", "c02", "c03", "c04", "c05", "c06", "c07", "c08"]  # коды ТЗ идут в порядке чек-листа
ROOT = Path(__file__).resolve().parent.parent


def value_of(answer):
    return {"yes": True, "no": False, "NA": None}.get(answer, answer)  # число шкалы остаётся числом


def expected_turns(transcript, checked):
    """Для «Нет» без цитаты: реплики участка checked_range (номера с 1), реплики оператора в приоритете, не больше 5."""
    ids = [t["id"] for t in transcript]
    if not checked or checked.get("from") not in ids or checked.get("to") not in ids:
        return []
    span = range(ids.index(checked["from"]), ids.index(checked["to"]) + 1)
    ops = [i for i in span if transcript[i]["speaker"] == "operator"]
    return [i + 1 for i in (ops or list(span))[-5:]]


def converted(conn, ev, transcript):
    ids = [t["id"] for t in transcript]
    res = {r["criterion_id"]: r for r in db.rows(conn, "SELECT * FROM criterion_results WHERE evaluation_id=?", (ev["id"],))}
    missing = [cid for cid in CHECKLIST_ORDER if cid not in res]
    if missing:
        raise ValueError(f"в оценке нет критериев стандартного чек-листа: {', '.join(missing)}")
    criteria = []
    for cid, code in zip(CHECKLIST_ORDER, CODES):
        r = res[cid]
        evidence = [e["id"] for e in json.loads(r["evidence_json"] or "[]")]
        turns = [ids.index(i) + 1 for i in evidence if i in ids]  # нумерация с 1 по всему транскрипту
        criteria.append({"criterion_id": code, "value": value_of(json.loads(r["final_answer"])), "rationale": r["reason"] or "",
                         "evidence_turns": turns or expected_turns(transcript, json.loads(r["checked_range_json"] or "null"))})
    total = ev["final_total"]
    return {"status": "ok", "criteria": criteria,
            "score": {"final_score": None if total is None else round(total, 2), "critical_flag": bool(ev["final_critical_flag"])}}


def build(group_id, team, checklist="chat-quality"):
    results, models = [], set()
    with closing(db.connect()) as conn:
        for c in db.rows(conn, "SELECT conversation_id, transcript_json FROM conversations WHERE group_id=? ORDER BY rowid", (group_id,)):
            transcript = json.loads(c["transcript_json"])
            evs = db.rows(conn, "SELECT * FROM evaluations WHERE group_id=? AND conversation_id=? AND checklist_id=? ORDER BY id DESC",
                          (group_id, c["conversation_id"], checklist))
            latest = next((e for e in evs if e["status"] not in ("queued", "running")), None)  # брошенные при перезапуске строки не считаем
            done = latest if latest and latest["status"] == "done" else None
            item = None
            if done:
                try:
                    item = converted(conn, done, transcript)
                    models.add(done["model"])
                except ValueError as e:
                    err = str(e)
            else:
                err = (latest["error"] if latest else None) or f"Нет готовой оценки по чек-листу {checklist}."
            if item is None:  # ошибку не прячем и нулём не подменяем
                item = {"status": "error", "criteria": [], "score": None, "error": err}
            results.append({"conversation_id": c["conversation_id"], **item})
    mode = "external_api" if models - {"mock"} else "local"
    return {"schema_version": "1.0", "team_name": team, "model": {"mode": mode, "name": ", ".join(sorted(m or "?" for m in models))}, "results": results}


def check(doc):
    ids = [r["conversation_id"] for r in doc["results"]]
    assert len(ids) == len(set(ids)), "повторяются conversation_id"
    for r in doc["results"]:
        if r["status"] == "ok":
            assert [c["criterion_id"] for c in r["criteria"]] == CODES, r["conversation_id"]
        else:
            assert r["criteria"] == [] and r["score"] is None and r["error"], r["conversation_id"]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("group_id")
    ap.add_argument("folder", choices=["dev", "prod"])
    ap.add_argument("team")
    ap.add_argument("--checklist", default="chat-quality", help="id чек-листа, по которому берутся оценки")
    a = ap.parse_args()
    doc = build(a.group_id, a.team, a.checklist)
    check(doc)
    out = ROOT / "results" / a.folder / "results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bad = sum(r["status"] == "error" for r in doc["results"])
    print(f"{out}: {len(doc['results'])} диалогов, ошибок {bad}, модель: {doc['model']['name']}", file=sys.stderr)
