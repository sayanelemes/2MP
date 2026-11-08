"""Точность оценки против ручной разметки (tests/golden.json). Модель не вызывается: берутся готовые оценки из базы.

Запуск: python -m tests.eval_golden --group DEV --checklist chat-quality [--holdout]
"""
import argparse
import json
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from backend import db, scoring

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = Path(__file__).with_name("golden.json")


def _pct(ok, n):
    return None if not n else round(100 * ok / n, 1)


def report(group, checklist, holdout=False, golden=None):
    golden = [g for g in (golden if golden is not None else json.loads(GOLDEN.read_text(encoding="utf-8")))
              if g["group_id"] == group and bool(g.get("holdout")) == holdout and not g.get("example")]
    hit, per_crit, per_lang, per_channel = defaultdict(int), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    na_no, no_na, scale_exact, scale_near, scale_n = 0, 0, 0, 0, 0
    quotes, quotes_ok, missed, false_alarm, diffs, mismatches, bad_status = 0, 0, [], [], [], [], defaultdict(int)
    with closing(db.connect()) as conn:
        latest = {e["conversation_id"]: e for e in db.latest_evaluations(conn, group, checklist)}
        convs = {c["conversation_id"]: c for c in db.rows(conn, "SELECT conversation_id, channel, language FROM conversations WHERE group_id=?", (group,))}
        for g in golden:
            cid, ev = g["conversation_id"], latest.get(g["conversation_id"])
            if ev is None or ev["status"] != "done":
                bad_status[ev["status"] if ev else "нет оценки"] += 1
                continue
            full = db.get_evaluation(conn, ev["id"])
            cl = db.get_checklist(conn, ev["checklist_id"], ev["checklist_version"])
            crit = {c["id"]: c for c in cl["criteria"]}
            conv = convs.get(cid, {})
            for r in full["results"]:
                expert = g["answers"].get(r["criterion_id"])
                if expert is None:
                    continue
                ai, c = r["ai_answer"], crit[r["criterion_id"]]
                for q in r["evidence"]:
                    quotes += 1
                    quotes_ok += bool(q.get("verified"))
                ok = ai == expert
                for d, key in ((per_lang, conv.get("language")), (per_channel, conv.get("channel"))):
                    d[key][0] += ok; d[key][1] += 1
                per_crit[r["criterion_id"]][0] += ok; per_crit[r["criterion_id"]][1] += 1
                hit["ok"] += ok; hit["all"] += 1
                if c.get("is_critical"):
                    if expert == "yes" and ai != "yes":
                        missed.append((cid, c["id"]))
                    if expert != "yes" and ai == "yes":
                        false_alarm.append((cid, c["id"]))
                if ai == "NA" and expert == "no":
                    na_no += 1
                if ai == "no" and expert == "NA":
                    no_na += 1
                if c["type"] == "scale" and isinstance(ai, (int, float)) and isinstance(expert, (int, float)):
                    steps = sorted(s["value"] for s in c["steps"])
                    scale_n += 1
                    scale_exact += ai == expert
                    scale_near += abs(steps.index(ai) - steps.index(expert)) <= 1
                if not ok:
                    mismatches.append({"conversation_id": cid, "criterion_id": r["criterion_id"], "expert": expert, "ai": ai, "reason": r["reason"]})
            try:
                want = scoring.compute(cl["criteria"], g["answers"])["total"]
                diffs.append(abs(want - full["ai_total"]))
            except (ValueError, KeyError, TypeError):
                pass  # разметка неполная: итог не сравниваем
    return {
        "dialogs": len(golden) - sum(bad_status.values()), "not_evaluated": dict(bad_status),
        "overall_pct": _pct(hit["ok"], hit["all"]),
        "by_criterion": {k: _pct(*v) for k, v in sorted(per_crit.items())},
        "by_language": {k: _pct(*v) for k, v in sorted(per_lang.items(), key=lambda x: str(x[0]))},
        "by_channel": {k: _pct(*v) for k, v in sorted(per_channel.items(), key=lambda x: str(x[0]))},
        "ai_na_expert_no": na_no, "ai_no_expert_na": no_na,
        "scale": {"n": scale_n, "exact": scale_exact, "within_one_step": scale_near},
        "mean_total_diff": round(sum(diffs) / len(diffs), 2) if diffs else None,
        "critical_missed": missed, "critical_false": false_alarm,
        "verified_quotes_pct": _pct(quotes_ok, quotes),
        "mismatches": mismatches,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default="DEV")
    ap.add_argument("--checklist", default="chat-quality")
    ap.add_argument("--holdout", action="store_true", help="только отложенные диалоги")
    ap.add_argument("--golden", default=str(GOLDEN), help="файл разметки (по умолчанию tests/golden.json)")
    a = ap.parse_args()
    rep = report(a.group, a.checklist, a.holdout, json.loads(Path(a.golden).read_text(encoding="utf-8")))
    (ROOT / "eval_report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in rep.items() if k != "mismatches"}, ensure_ascii=False, indent=2))
    for m in rep["mismatches"]:
        print(f"{m['conversation_id']} {m['criterion_id']}: эксперт {m['expert']!r}, ИИ {m['ai']!r} — {m['reason']}")
