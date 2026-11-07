"""Проверка ответа модели. Неподтверждённая цитата — не ошибка, а пометка verified: false."""
import json
import re
import unicodedata


def _norm(text):
    text = unicodedata.normalize("NFKC", text or "").lower()
    text = re.sub(r"\s+", " ", text).strip()
    return text.strip("\"'«»„“”‘’`").strip()


def _answer(c, raw):
    """Приводит ответ к виду для scoring: 'yes' | 'no' | 'NA' | число. None, если недопустим."""
    a = str(raw).strip()
    if a.lower() in ("na", "n/a"):
        return "NA" if c.get("na_allowed") and not c.get("is_critical") else None
    if c["type"] == "yes_no":
        return a.lower() if a.lower() in ("yes", "no") else None
    try:
        num = float(a.replace(",", "."))
    except ValueError:
        return None
    for s in c["steps"]:
        if s["value"] == num:
            return s["value"]
    return None


ADVICE = re.compile(r"^(уточните|предложите|обязательно|рекомендуется|оператору следует|нужно|следует|ask|offer|make sure|should)\b",
                    re.IGNORECASE)
CYR, LAT, KZ_LETTERS = re.compile("[а-яёәғқңөұүһі]", re.I), re.compile("[a-z]", re.I), re.compile("[әғқңөұүһі]", re.I)


def _plain(text):
    return re.sub(r"[^\w ]", "", _norm(text)).strip()


def _clean_suggestion(c, answer, raw, language, operator_texts):
    """Готовая реплика оператора для места, где он потерял баллы. Плохая подсказка — пустая строка, оценка остаётся."""
    text = re.sub(r"\s+", " ", str(raw or "")).strip().strip("\"«»").strip()
    partial = answer == "no" if c["type"] == "yes_no" else (answer != "NA" and answer < max(s["value"] for s in c["steps"]))
    if not text or c.get("is_critical") or answer == "NA" or not partial:
        return ""
    words = text.split()
    if len(words) > 25 or ADVICE.match(text):
        return ""
    lang = (language or "").upper()
    if lang == "EN" and (not LAT.search(text) or CYR.search(text)):
        return ""
    if lang in ("RU", "KZ") and not CYR.search(text):
        return ""
    if lang == "KZ" and len(words) > 5 and not KZ_LETTERS.search(text):
        return ""
    plain = _plain(text)
    if any(plain == t or plain in t for t in operator_texts):  # повторил то, что оператор и так сказал
        return ""
    return text


def strip_fence(raw_text):
    """Ответ модели без обёртки ```json ... ```."""
    return re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw_text or "").strip())


def validate(raw_text, conversation, checklist):
    text = strip_fence(raw_text)
    try:
        data = json.loads(text)
    except ValueError as e:
        return [], [f"ответ не JSON: {e}"]
    items = data.get("results") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return [], ["нет массива results"]

    transcript = conversation["transcript"]
    index = {u["id"]: i for i, u in enumerate(transcript)}
    criteria = {c["id"]: c for c in checklist["criteria"]}
    errors, by_id = [], {}
    operator_texts = [_plain(u["text"]) for u in transcript if u["speaker"] == "operator"]
    for item in items:
        cid = item.get("criterion_id") if isinstance(item, dict) else None
        if cid not in criteria:
            errors.append(f"лишний или неизвестный критерий {cid!r}")
        elif cid in by_id:
            errors.append(f"{cid}: повторяется")
        else:
            by_id[cid] = item
    errors += [f"{cid}: нет результата" for cid in criteria if cid not in by_id]

    results = []
    for cid, c in criteria.items():
        item = by_id.get(cid)
        if item is None:
            continue
        answer = _answer(c, item.get("answer"))
        if answer is None:
            allowed = "yes/no" if c["type"] == "yes_no" else "/".join(str(s["value"]) for s in c["steps"])
            na = ", NA" if c.get("na_allowed") and not c.get("is_critical") else ""
            errors.append(f"{cid}: недопустимый ответ {item.get('answer')!r}, можно {allowed}{na}")
            continue
        if not str(item.get("reason") or "").strip():
            errors.append(f"{cid}: пустой reason")

        evidence = []
        for e in item.get("evidence") or []:
            uid = e.get("id") if isinstance(e, dict) else None
            if uid not in index:
                errors.append(f"{cid}: реплики {uid!r} нет в транскрипте")
                continue
            quote = str(e.get("quote") or "")
            verified = bool(_norm(quote)) and _norm(quote) in _norm(transcript[index[uid]]["text"])
            evidence.append({"id": uid, "quote": quote, "verified": verified})

        checked = item.get("checked_range")
        if checked:
            frm, to = checked.get("from"), checked.get("to")
            if frm not in index or to not in index:
                errors.append(f"{cid}: границы checked_range {frm!r}–{to!r} не найдены")
                checked = None
            elif index[frm] > index[to]:
                errors.append(f"{cid}: checked_range начинается позже конца")
                checked = None
            else:
                checked = {"from": frm, "to": to}
        else:
            checked = None

        if answer == "yes" and not any(transcript[index[e["id"]]]["speaker"] in ("operator", "system")
                                       for e in evidence):
            errors.append(f"{cid}: для yes нужна реплика оператора или системное сообщение в evidence")
        if answer != "NA" and answer != "yes" and not evidence and not checked:
            if c.get("is_critical"):  # «нет нарушения»: весь участок оператора
                ops = [u["id"] for u in transcript if u["speaker"] == "operator"] or [transcript[0]["id"],
                                                                                      transcript[-1]["id"]]
                checked = {"from": ops[0], "to": ops[-1]}
            else:
                errors.append(f"{cid}: без evidence нужен checked_range")

        results.append({"criterion_id": cid, "answer": answer, "reason": str(item.get("reason") or "").strip(),
                        "evidence": evidence, "checked_range": checked,
                        "suggestion": _clean_suggestion(c, answer, item.get("suggestion"), conversation.get("language"),
                                                        operator_texts)})
    return (results, errors) if not errors else ([], errors)
