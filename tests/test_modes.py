"""Режимы оценки: секции, повтор при неподтверждённых цитатах, перепроверка грубых нарушений. Модель — заглушка _call."""
import json
import re

import pytest

from backend import config, evaluator
from tests.conftest import STANDARD
from tests.test_api import _record, _wait

GOOD = {"c01": ("yes", "Здравствуйте"), "c02": ("yes", "Здравствуйте"), "c03": ("yes", "Здравствуйте"), "c04": ("15", "Здравствуйте"),
        "c05": ("yes", "Здравствуйте"), "c06": ("7", "Здравствуйте"), "c07": ("yes", "До свидания"), "c08": ("no", None)}


def reply(ids, overrides=None):
    out = []
    for cid in ids:
        answer, quote = {**GOOD, **(overrides or {})}[cid]
        uid = "u3" if quote == "До свидания" else "u2"
        out.append({"criterion_id": cid, "reason": "ок", "answer": answer, "checked_range": {"from": "u1", "to": "u3"} if quote is None else None,
                    "evidence": [] if quote is None else [{"id": uid, "quote": quote}]})
    return json.dumps({"results": out})


@pytest.fixture
def run(client, monkeypatch):
    """run(script) → (сохранённая оценка, список id критериев в каждом запросе). script(вызов, ids) возвращает ответ модели."""
    monkeypatch.setattr(config, "LLM_PROVIDER", "gemini")
    monkeypatch.setattr(config, "LLM_MODEL", "test")
    calls = []

    def fake_call(system, user):
        ids = re.findall(r"^(c\d+) \|", user, re.M)
        calls.append(ids)
        return script(len(calls), ids)

    def go(script_fn):
        nonlocal script
        script = script_fn
        client.post("/api/conversations/upload?group_id=G", json=[_record("a")])
        client.post("/api/checklists", json={**STANDARD, "id": "std"})
        monkeypatch.setattr(evaluator, "_call", fake_call)
        job = client.post("/api/evaluations", json={"group_id": "G", "all": True, "checklist_id": "std"}).json()
        _wait(client, job["job_id"])
        c = client.get("/api/conversations?group_id=G").json()[0]
        return client.get(f"/api/evaluations/{c['evaluation_id']}").json(), calls

    script = None
    return go


def test_sections_one_call_per_section(run, monkeypatch):
    monkeypatch.setattr(config, "EVAL_MODE", "sections")
    ev, calls = run(lambda n, ids: reply(ids))
    assert [len(c) for c in calls] == [2, 4, 2] and ev["status"] == "done"
    assert [r["criterion_id"] for r in ev["results"]] == [f"c0{i}" for i in range(1, 9)]


def test_single_mode_one_call(run):
    ev, calls = run(lambda n, ids: reply(ids))
    assert len(calls) == 1 and ev["status"] == "done"


def test_section_failure_is_needs_review(run, monkeypatch):
    monkeypatch.setattr(config, "EVAL_MODE", "sections")
    ev, calls = run(lambda n, ids: "не json" if "c03" in ids else reply(ids))
    assert ev["status"] == "needs_review" and len(calls) == 4  # 2 запроса на сорванную секцию


def test_unverified_quote_retried_once(run):
    bad = {"c01": ("yes", "такого нет в диалоге")}
    ev, calls = run(lambda n, ids: reply(ids, bad if n == 1 else None))
    assert len(calls) == 2 and ev["results"][0]["evidence"][0]["verified"] is True


def test_unverified_quote_kept_after_retry(run):
    bad = {"c01": ("yes", "такого нет в диалоге")}
    ev, calls = run(lambda n, ids: reply(ids, bad))
    assert len(calls) == 2 and ev["status"] == "done" and ev["results"][0]["evidence"][0]["verified"] is False


def test_retry_can_be_disabled(run, monkeypatch):
    monkeypatch.setattr(config, "QUOTE_RETRY", False)
    ev, calls = run(lambda n, ids: reply(ids, {"c01": ("yes", "такого нет в диалоге")}))
    assert len(calls) == 1


def test_critical_recheck_finds_violation(run, monkeypatch):
    monkeypatch.setattr(config, "CRITICAL_RECHECK", True)
    ev, calls = run(lambda n, ids: reply(ids) if n == 1 else reply(ids, {"c08": ("yes", "Здравствуйте")}))
    last = ev["results"][-1]
    assert calls[1] == ["c08"] and last["final_answer"] == "yes" and "повторной" in last["reason"] and ev["final_critical_flag"]


def test_critical_recheck_unverified_quote_stays_no(run, monkeypatch):
    monkeypatch.setattr(config, "CRITICAL_RECHECK", True)
    ev, calls = run(lambda n, ids: reply(ids) if n == 1 else reply(ids, {"c08": ("yes", "выдуманная цитата")}))
    assert ev["results"][-1]["final_answer"] == "no" and not ev["final_critical_flag"]
