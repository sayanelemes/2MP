"""Очередь оценки: фоновый поток, лимит запросов, повторы, проверка ответа.

LLM_PROVIDER пуст или mock — детерминированная заглушка без сети (сайт работает без ключей).
"""
import hashlib
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from . import config, db, llm, prompts, validator

PROMPT_VERSION = prompts.PROMPT_VERSION if config.LLM_PROVIDER != "mock" else "mock"
RETRIES = 3

_rate_lock = threading.Lock()
_next_call = 0.0


def current_model():
    return llm.model_name()


def start_job(job_id: int, evaluation_ids: list[int]) -> None:
    threading.Thread(target=_run, args=(evaluation_ids,), daemon=True).start()


def _run(evaluation_ids):
    with ThreadPoolExecutor(max(1, config.LLM_CONCURRENCY)) as pool:
        list(pool.map(_evaluate_safe, evaluation_ids))


def _evaluate_safe(eid):
    try:
        _evaluate(eid)
    except Exception as e:  # один сбой не останавливает задание
        traceback.print_exc()
        try:
            db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "error", str(e)[:500])
        except Exception:
            traceback.print_exc()


def _evaluate(eid):
    db.set_evaluation_running(eid)
    ctx = db.get_evaluation_context(eid)
    conv, checklist = ctx["conversation"], ctx["checklist"]
    if config.LLM_PROVIDER == "mock":
        db.save_evaluation_result(eid, _mock(ctx), current_model(), PROMPT_VERSION, "done")
        return
    if conv["channel"] == "voice call" and not config.LLM_ALLOW_VOICE:
        db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "needs_review",
                                  "звонки не отправляются в ИИ до разрешения организаторов (LLM_ALLOW_VOICE)")
        return
    user = prompts.build_user(conv, checklist)
    message = user
    for attempt in range(2):  # ошибка JSON или правил: один повтор с текстом ошибки
        try:
            raw = _call(prompts.SYSTEM, message)
        except llm.LLMError as e:
            db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "error", str(e))
            return
        results, errors = validator.validate(raw, conv, checklist)
        if not errors:
            db.save_evaluation_result(eid, results, current_model(), PROMPT_VERSION, "done")
            return
        print(f"оценка {eid}, попытка {attempt + 1}: {'; '.join(errors)[:300]} | ответ: {(raw or '')[:200]}")
        message = (user + "\n\nПредыдущий ответ отклонён проверкой: " + "; ".join(errors)
                   + "\nВерни исправленный JSON целиком.")
    db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "needs_review", "; ".join(errors)[:1000])


def _wait_rate():
    global _next_call
    with _rate_lock:
        now = time.monotonic()
        wait = _next_call - now
        _next_call = max(now, _next_call) + 60 / max(config.LLM_RPM, 0.1)
    if wait > 0:
        time.sleep(wait)


def _call(system, user):
    """429/5xx/сеть: до 3 повторов с нарастающей паузой, учитывая Retry-After."""
    for attempt in range(RETRIES + 1):
        _wait_rate()
        try:
            return llm.generate_json(system, user, prompts.SCHEMA)
        except llm.LLMError as e:
            if not e.retryable or attempt == RETRIES:
                raise
            pause = e.retry_after or 10 * 2 ** attempt
            print(f"LLM: {e}, повтор через {pause:.0f} с")
            time.sleep(pause)


def _mock(ctx):
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
