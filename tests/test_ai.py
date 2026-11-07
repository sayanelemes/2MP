import json

import pytest

from backend import checklists, config, db, evaluator, llm, prompts
from backend.validator import validate

SEED = json.loads(config.SEED_CHECKLIST.read_text(encoding="utf-8"))
CONV = {"conversation_id": "x", "channel": "agent chat", "language": "KZ", "transcript": [
    {"id": "u1", "t": 0, "timestamp": "00:00", "speaker": "client", "text": "Сәлеметсіз бе, тариф қайда?"},
    {"id": "u2", "t": 5, "timestamp": "00:05", "speaker": "operator", "text": "Сәлеметсіз бе! Менің атым «Айгүл».  Көмектесемін"},
    {"id": "u3", "t": 70, "timestamp": "01:10", "speaker": "operator", "text": "Тариф қосымшада, Профиль бөлімінде."},
    {"id": "u4", "t": None, "timestamp": "??", "speaker": "system", "text": "Чат закрыт."}]}


def item(cid, answer, evidence=(), checked=None, reason="r"):
    return {"criterion_id": cid, "reason": reason, "answer": answer,
            "evidence": [{"id": i, "quote": q} for i, q in evidence], "checked_range": checked}


def good():
    return [item("c01", "yes", [("u2", "менің атым  «айгүл»")]), item("c02", "NA"), item("c03", "NA"),
            item("c04", "15", [("u3", "Тариф қосымшада")]), item("c05", "yes", [("u2", "Көмектесемін")]),
            item("c06", "10", [("u3", "Профиль бөлімінде")]), item("c07", "no", checked={"from": "u3", "to": "u4"}),
            item("c08", "no")]


def test_seed_is_valid():
    assert checklists.validate(SEED) == []


def test_prompt_lines():
    text = prompts.build_user(CONV, SEED)
    assert "[u3 | 01:10] operator: Тариф" in text and "[u4 | ??] system" in text
    assert "NA разрешён, если: Данных для ответа хватало" in text


def test_valid_answer():
    results, errors = validate(json.dumps({"results": good()}), CONV, SEED)
    assert errors == []
    by = {r["criterion_id"]: r for r in results}
    assert by["c04"]["answer"] == 15 and by["c02"]["answer"] == "NA"
    assert by["c01"]["evidence"][0]["verified"] is True  # NFKC, регистр, пробелы, кавычки
    assert by["c08"]["checked_range"] == {"from": "u2", "to": "u3"}  # авто-участок оператора


def test_unverified_quote_is_not_an_error():
    r = good()
    r[0] = item("c01", "yes", [("u2", "Здравствуйте, меня зовут Анна")])
    results, errors = validate("```json\n" + json.dumps({"results": r}) + "\n```", CONV, SEED)
    assert errors == [] and results[0]["evidence"][0]["verified"] is False


def test_rule_errors():
    cases = [
        (lambda r: r.pop(), "c08: нет результата"),
        (lambda r: r.append(item("c99", "yes")), "c99"),
        (lambda r: r.__setitem__(0, item("c01", "NA")), "c01: недопустимый ответ"),
        (lambda r: r.__setitem__(3, item("c04", "12", [("u3", "x")])), "c04: недопустимый ответ"),
        (lambda r: r.__setitem__(0, item("c01", "yes", [("u1", "Сәлеметсіз")])), "реплика оператора"),
        (lambda r: r.__setitem__(0, item("c01", "yes", [("u9", "x")])), "u9"),
        (lambda r: r.__setitem__(6, item("c07", "no")), "c07: без evidence нужен checked_range"),
        (lambda r: r.__setitem__(6, item("c07", "no", checked={"from": "u4", "to": "u1"})), "позже конца"),
        (lambda r: r.__setitem__(4, item("c05", "yes", [("u2", "x")], reason=" ")), "пустой reason"),
    ]
    for change, expected in cases:
        r = good()
        change(r)
        results, errors = validate(json.dumps({"results": r}), CONV, SEED)
        assert results == [] and any(expected in e for e in errors), (expected, errors)
    assert validate("не json", CONV, SEED)[1][0].startswith("ответ не JSON")


def _setup(client, monkeypatch, replies):
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(config, "LLM_RPM", 6000)
    calls = []

    def fake(system, user, schema):
        calls.append(user)
        reply = replies[min(len(calls), len(replies)) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(llm, "generate_json", fake)
    monkeypatch.setattr(evaluator, "start_job", lambda job_id, ids: evaluator._run(ids))  # синхронно для теста
    record = {**CONV, "transcript": [{k: u[k] for k in ("timestamp", "speaker", "text")} for u in CONV["transcript"]]}
    client.post("/api/conversations/upload?group_id=G", json=record)
    client.post("/api/checklists", json=SEED)
    job = client.post("/api/evaluations", json={"group_id": "G", "all": True, "checklist_id": "chat-quality"}).json()
    eid = client.get("/api/conversations?group_id=G").json()[0]["evaluation_id"]
    return client.get(f"/api/jobs/{job['job_id']}").json(), client.get(f"/api/evaluations/{eid}").json(), calls


def test_retry_then_done(client, monkeypatch):
    job, ev, calls = _setup(client, monkeypatch, ["{}", json.dumps({"results": good()})])
    assert len(calls) == 2 and "Предыдущий ответ отклонён" in calls[1]
    assert ev["status"] == "done" and ev["model"] == "gemini-3.6-flash" and job["done"] == 1
    assert ev["ai_total"] == 84.62  # c02, c03 N/A: 55 баллов из 65 применимых


def test_needs_review_and_error(client, monkeypatch):
    job, ev, calls = _setup(client, monkeypatch, ["{}"])
    assert len(calls) == 2 and ev["status"] == "needs_review" and ev["ai_total"] is None and ev["error"]
    assert job["status"] == "done" and job["done"] == 1


def test_provider_error(client, monkeypatch):
    job, ev, _ = _setup(client, monkeypatch, [llm.LLMError("провайдер ответил 400: bad")])
    assert ev["status"] == "error" and "400" in ev["error"] and job["failed"] == 1


def test_fallback_provider_on_429(monkeypatch):
    """Лимит у первого провайдера → ответ даёт второй, в оценку идёт его модель; провайдер в паузе пропускается."""
    from backend import llm
    calls = []

    def fake(provider, key, *a):
        calls.append((provider, key))
        if provider == "gemini":
            raise llm.LLMError("429", retryable=True, status=429)
        return "{}"
    monkeypatch.setattr(config, "LLM_PROVIDERS", ["gemini", "groq"])
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(llm, "_generate", fake)
    monkeypatch.setattr(llm, "_blocked", {})
    monkeypatch.setattr(config, "GROQ_API_KEY", "")  # не зависеть от реального .env
    monkeypatch.setattr(config, "GEMINI_API_KEY", "k1, k2")  # два ключа Gemini: оба в 429 → Groq
    assert llm.generate_json("s", "u", {}) == "{}" and calls == [("gemini", "k1"), ("gemini", "k2"), ("groq", "")]
    assert llm.model_name() == llm.DEFAULT_MODELS["groq"]
    calls.clear()
    llm.generate_json("s", "u", {})
    assert calls == [("groq", "")]
    monkeypatch.setattr(llm, "_generate", lambda *a: (_ for _ in ()).throw(llm.LLMError("429", retryable=True)))
    monkeypatch.setattr(llm, "_blocked", {})
    with pytest.raises(llm.LLMError):
        llm.generate_json("s", "u", {})


def test_facts_block():
    conv = {"transcript": [
        {"id": "u1", "t": 0, "timestamp": "00:00", "speaker": "client", "text": "Сәлем"},
        {"id": "u2", "t": 3, "timestamp": "00:03", "speaker": "bot", "text": "Hello"},
        {"id": "u3", "t": 4, "timestamp": "00:04", "speaker": "system", "text": "Escalation to agent."},
        {"id": "u4", "t": 100, "timestamp": "01:40", "speaker": "operator", "text": "Привет"},
        {"id": "u5", "t": 110, "timestamp": "01:50", "speaker": "client", "text": "Вопрос"},
        {"id": "u6", "t": 260, "timestamp": "04:20", "speaker": "operator", "text": "Ответ"},
        {"id": "u7", "t": 270, "timestamp": "04:30", "speaker": "client", "text": "Спасибо"}]}
    facts = prompts.facts_block(conv)
    assert "Первая реплика оператора: u4 (01:40)" in facts and "Реплик бота: 1" in facts
    assert "[u3] Escalation to agent." in facts and "Последним говорил: client (u7)" in facts
    assert "Последняя реплика оператора: u6" in facts
    assert "u5 → u6: 02:30" in facts and "u1 → u4" not in facts  # первая реакция в паузы не входит
    assert "Реплик оператора: 2, клиента: 3" in facts
    assert "Факты из транскрипта" in prompts.build_user({**CONV, "transcript": conv["transcript"]}, SEED)


def test_anthropic_provider_collects_text_blocks(monkeypatch):
    from backend import config, llm
    seen = {}
    monkeypatch.setattr(config, "ANTHROPIC_API_KEY", "k1")
    monkeypatch.setattr(llm, "_post", lambda url, headers, body: seen.update(url=url, headers=headers, body=body) or
                        {"content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": '{"a":1}'}]})
    assert llm._generate("anthropic", "k1", "sys", "usr", {}) == '{"a":1}'
    assert seen["url"].endswith("/v1/messages") and seen["headers"]["x-api-key"] == "k1"
    assert seen["body"]["model"] == "claude-haiku-5-5" and seen["body"]["system"] == "sys" and "temperature" not in seen["body"]
