"""Детерминированная замена модели для тестов: без сети и без ключей."""
import hashlib


def stub(ctx):
    conv = ctx["conversation"]
    utts = conv["transcript"]
    operator = [u for u in utts if u["speaker"] == "operator"] or utts
    results = []
    for c in ctx["checklist"]["criteria"]:
        h = int(hashlib.sha256(f"{conv['conversation_id']}|{c['id']}".encode()).hexdigest(), 16)
        if c.get("is_critical"):
            answer = "yes" if h % 10 == 0 else "no"
        else:
            options = ["yes", "yes", "no"] if c["type"] == "yes_no" else [s["value"] for s in c["steps"]]
            if c.get("na_allowed"):
                options.append("NA")
            answer = options[h % len(options)]
        u = operator[h % len(operator)]
        results.append({
            "criterion_id": c["id"],
            "answer": answer,
            "reason": "Заглушка: ответ выбран детерминированно, модель не вызывалась.",
            "evidence": [] if answer == "NA" else [{"id": u["id"], "quote": u["text"][:200], "verified": True}],
            "checked_range": {"from": utts[0]["id"], "to": utts[-1]["id"]},
            "suggestion": "" if answer in ("yes", "NA") or c.get("is_critical") or (c["type"] == "scale" and answer == max(s["value"] for s in c["steps"]))
                          else "Подскажите, остались ли у вас ещё вопросы?",
        })
    return results
