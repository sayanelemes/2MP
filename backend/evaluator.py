"""Очередь оценки: фоновый поток, лимит запросов, повторы, проверка ответа.

Модель вызывается всегда; ключ и провайдер задаются в .env.
"""
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from . import config, db, llm, prompts, validator

# версия в ключе кэша учитывает режимы: результат другого режима не подменяет этот
PROMPT_VERSION = (
    prompts.PROMPT_VERSION + ("-sections" if config.EVAL_MODE == "sections" else "") + ("-recheck" if config.CRITICAL_RECHECK else "")
    + ("" if config.PROMPT_FACTS else "-nofacts") + ("" if config.QUOTE_RETRY else "-noretry"))
RETRIES = 3
_stub = None

_rate_lock = threading.Lock()
_next_call = 0.0


def current_model():
    return llm.model_name()


_cancelled = set()  # задания, остановленные пользователем
_current = threading.local()  # задание, которое сейчас выполняет поток
STOPPED = "остановлено пользователем"


def stop_job(job_id: int) -> None:
    """Новые диалоги задания не стартуют; уже отправленный запрос к модели дорабатывает."""
    _cancelled.add(job_id)


def _check_stopped():
    if getattr(_current, "job", None) in _cancelled:
        raise llm.LLMError(STOPPED)


def _sleep(seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        _check_stopped()
        time.sleep(min(1, max(0, end - time.monotonic())))


def start_job(job_id: int, evaluation_ids: list[int]) -> None:
    threading.Thread(target=_run, args=(job_id, evaluation_ids), daemon=True).start()


def _run(job_id, evaluation_ids):
    with ThreadPoolExecutor(max(1, config.LLM_CONCURRENCY)) as pool:
        list(pool.map(lambda eid: _evaluate_safe(eid, job_id), evaluation_ids))


def _evaluate_safe(eid, job_id=None):
    _current.job = job_id
    try:
        _check_stopped()
        _evaluate(eid)
    except Exception as e:  # один сбой не останавливает задание
        if isinstance(e, llm.LLMError) and str(e) == STOPPED:
            db.discard_unfinished(eid)
            return
        traceback.print_exc()
        try:
            db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "error", str(e)[:500])
        except Exception:
            traceback.print_exc()


def _evaluate(eid):
    db.set_evaluation_running(eid)
    ctx = db.get_evaluation_context(eid)
    conv, checklist = ctx["conversation"], ctx["checklist"]
    if _stub and config.LLM_PROVIDER == "mock":  # только тесты (tests/conftest.py), в работе _stub пуст
        db.save_evaluation_result(eid, _stub(ctx), current_model(), PROMPT_VERSION, "done")
        return
    if conv["channel"] == "voice call" and not config.LLM_ALLOW_VOICE:
        db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "needs_review",
                                  "звонки не отправляются в ИИ до разрешения организаторов (LLM_ALLOW_VOICE)")
        return
    try:
        results, errors = _evaluate_parts(conv, checklist)
    except llm.LLMError as e:
        if str(e) == STOPPED:
            raise
        db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "error", str(e))
        return
    if errors:
        db.save_evaluation_result(eid, [], current_model(), PROMPT_VERSION, "needs_review", "; ".join(errors)[:1000])
        return
    db.save_evaluation_result(eid, results, current_model(), PROMPT_VERSION, "done")


def _subset(checklist, criteria):
    return {**checklist, "criteria": criteria}


def _evaluate_parts(conv, checklist):
    """Режим single/sections и перепроверка грубых нарушений. Возвращает (results, errors)."""
    criteria = checklist["criteria"]
    if config.EVAL_MODE == "sections":
        parts = [[c for c in criteria if c.get("section") == s] for s in dict.fromkeys(c.get("section") for c in criteria)]
    else:
        parts = [criteria]
    results, errors = [], []
    for part in parts:
        r, e = _ask(conv, _subset(checklist, part))
        results += r
        errors += e
    if errors:
        return [], errors
    order = {c["id"]: i for i, c in enumerate(criteria)}
    results.sort(key=lambda r: order[r["criterion_id"]])
    critical = [c for c in criteria if c.get("is_critical")]
    if config.CRITICAL_RECHECK and critical:
        second, e = _ask(conv, _subset(checklist, critical))
        by2 = {r["criterion_id"]: r for r in second}  # сбой повторной проверки не мешает: решает основная
        speakers = {u["id"]: u["speaker"] for u in conv["transcript"]}
        results = [_merge_critical(r, by2.get(r["criterion_id"]), speakers) if r["criterion_id"] in {c["id"] for c in critical} else r
                   for r in results]
    return results, []


def _found(r, speakers):
    return bool(r) and r["answer"] == "yes" and any(e["verified"] and speakers.get(e["id"]) == "operator" for e in r["evidence"])


def _merge_critical(main, second, speakers):
    """yes только если хотя бы одна проверка дала yes с подтверждённой цитатой из реплики оператора."""
    for name, r in (("основной", main), ("повторной", second)):
        if _found(r, speakers):
            return {**r, "reason": f"Нарушение найдено при {name} проверке. {r['reason']}"}
    note = " Нарушение не засчитано: нет подтверждённой цитаты оператора." if main["answer"] == "yes" else ""
    return {**main, "answer": "no", "reason": main["reason"] + note}


def _unverified(results):
    """Критерии с ответом yes или баллом шкалы, у которых все цитаты не найдены в репликах."""
    return [r for r in results if r["answer"] not in ("no", "NA") and r["evidence"] and not any(e["verified"] for e in r["evidence"])]


def _ask(conv, checklist):
    """Запрос по подмножеству критериев. Не больше 2 запросов: повтор при ошибке проверки или неподтверждённых цитатах."""
    user = prompts.build_user(conv, checklist)
    message, fallback, errors = user, None, []
    for attempt in range(2):
        raw = _call(prompts.SYSTEM, message)
        results, errors = validator.validate(raw, conv, checklist)
        if errors:
            print(f"оценка {conv['conversation_id']}, попытка {attempt + 1}: {'; '.join(errors)[:300]} | ответ: {(raw or '')[:200]}")
            message = (user + "\n\nПредыдущий ответ отклонён проверкой: " + "; ".join(errors)
                       + "\nВерни исправленный JSON целиком.")
            continue
        bad = _unverified(results) if config.QUOTE_RETRY else []
        if bad and attempt == 0:
            fallback = results
            lost = ", ".join(f"{r['criterion_id']} ({', '.join(e['id'] for e in r['evidence'])})" for r in bad)
            message = (user + f"\n\nЦитаты не найдены в указанных репликах: {lost}. "
                       "Скопируй цитату дословно из текста реплики или измени вывод. Верни JSON целиком.")
            continue
        return results, []
    return (fallback, []) if fallback else ([], errors)


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
        _check_stopped()
        _wait_rate()
        _check_stopped()
        try:
            return llm.generate_json(system, user, prompts.SCHEMA)
        except llm.LLMError as e:
            if not e.retryable or attempt == RETRIES:
                raise
            pause = e.retry_after or 10 * 2 ** attempt
            print(f"LLM: {e}, повтор через {pause:.0f} с")
            _sleep(pause)
