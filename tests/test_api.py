import json
import time
from pathlib import Path

import pytest

from backend import datasets, db, evaluator
from tests.conftest import ROW1, STANDARD

DEV = Path.home() / "Downloads" / "DEV.json"


def _record(cid="t-001", **kw):
    return {"conversation_id": cid, "channel": "agent chat", "language": "RU", "audio_url": None,
            "transcript": [{"timestamp": "00:00", "speaker": "client", "text": "Привет"},
                           {"timestamp": "01:05", "speaker": "operator", "text": "Здравствуйте"},
                           {"timestamp": "xx", "speaker": "operator", "text": "До свидания"}], **kw}


def _wait(client, job_id):
    for _ in range(100):
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == "done":
            return job
        time.sleep(0.05)
    raise AssertionError(job)


def test_normalize_times():
    chat = datasets.normalize(_record())["transcript"]
    assert [(u["id"], u["t"]) for u in chat] == [("u1", 0), ("u2", 65), ("u3", None)]
    call = datasets.normalize(_record(transcript=[
        {"timestamp": "2026-11-03T15:49:13.1900670+00:00", "speaker": "system", "text": "a"},
        {"timestamp": "2026-11-03T15:49:13.2744711+00:00", "speaker": "system", "text": "b"},
        {"timestamp": "2026-11-03T15:50:20.1500000+00:00", "speaker": "client", "text": "c"}]))["transcript"]
    assert [u["t"] for u in call] == [0.0, 0.1, 67.0]
    assert call[0]["timestamp"] == "2026-11-03T15:49:13.1900670+00:00"


def test_api_url_replaces_group_id(monkeypatch):
    monkeypatch.setattr(datasets.config, "CQA_API_URL", "https://x/y?a=1&sig=a%2Fb&group_id=DEV")
    assert datasets.api_url("NEW 1") == "https://x/y?a=1&sig=a%2Fb&group_id=NEW%201"
    monkeypatch.setattr(datasets.config, "CQA_API_URL", "https://x/y?sig=s")
    assert datasets.api_url("A") == "https://x/y?sig=s&group_id=A"


def test_upload_formats_and_errors(client):
    assert client.post("/api/conversations/upload", json=_record()).json() == {"imported": 1}
    api = {"error": "", "isSuccess": True, "data": {"records": [_record("t-002"), _record("t-003")]}}
    assert client.post("/api/conversations/upload?group_id=X", json=api).json() == {"imported": 2}
    bad = client.post("/api/conversations/upload", json=[_record(transcript=[{"speaker": "agent", "text": "a"}])])
    assert bad.status_code == 422 and "agent" in bad.json()["detail"]
    assert client.post("/api/conversations/upload", json={"isSuccess": False, "error": "нет группы"}).status_code == 502


@pytest.mark.skipif(not DEV.exists(), reason="нет DEV.json")
def test_dev_import_idempotent(client):
    payload = json.loads(DEV.read_text(encoding="utf-8"))
    for _ in range(2):
        assert client.post("/api/conversations/upload?group_id=DEV", json=payload).json() == {"imported": 65}
    convs = client.get("/api/conversations?group_id=DEV").json()
    assert len(convs) == 65
    assert sum(1 for c in convs if c["audio_path"]) == 5
    detail = client.get("/api/conversations/DEV/p1-ru-001").json()
    assert "audio_url" not in detail and detail["transcript"][0]["id"] == "u1"
    lengths = sorted(c["turn_count"] for c in convs)
    assert lengths[0] == 11 and lengths[-1] == 115


def test_checklist_versions(client):
    bad = client.post("/api/checklists", json={**STANDARD, "criteria": [{**STANDARD["criteria"][7], "weight": 5}]})
    assert bad.status_code == 422
    r = client.post("/api/checklists", json=STANDARD).json()
    assert r["version"] == 1 and r["warnings"] == []
    assert client.post("/api/checklists", json=STANDARD).status_code == 409
    changed = {**STANDARD, "criteria": STANDARD["criteria"][:-2] + [{**STANDARD["criteria"][6], "weight": 10}]}
    r2 = client.put("/api/checklists/chat-quality", json=changed).json()
    assert r2["version"] == 2 and r2["warnings"]
    assert [v["version"] for v in client.get("/api/checklists/chat-quality/versions").json()] == [2, 1]
    assert len(client.get("/api/checklists/chat-quality/versions/1").json()["criteria"]) == 8


def test_full_path(client, monkeypatch):
    def fixed(job_id, ids):
        for eid in ids:
            db.set_evaluation_running(eid)
            db.save_evaluation_result(eid, [{"criterion_id": k, "answer": v, "reason": "r",
                                             "evidence": [{"id": "u2", "quote": "Здравствуйте", "verified": True}],
                                             "checked_range": {"from": "u1", "to": "u3"}} for k, v in ROW1.items()],
                                      "test", "1", "done")
    monkeypatch.setattr(evaluator, "start_job", fixed)
    client.post("/api/conversations/upload?group_id=G", json=_record())
    client.post("/api/checklists", json=STANDARD)
    job = client.post("/api/evaluations", json={"group_id": "G", "all": True, "checklist_id": "chat-quality"}).json()
    assert client.get(f"/api/jobs/{job['job_id']}").json()["status"] == "done"
    eid = client.get("/api/conversations?group_id=G").json()[0]["evaluation_id"]

    appeal = client.post("/api/appeals", json={"evaluation_id": eid, "criterion_id": "c07", "comment": "Попрощался"})
    assert appeal.status_code == 200
    assert client.post("/api/appeals", json={"evaluation_id": eid, "criterion_id": "c07",
                                             "comment": "ещё"}).status_code == 409
    queue = client.get("/api/appeals?status=open").json()
    assert client.get("/api/appeals?status=resolved").json() == []
    assert client.post("/api/checklists", json={**STANDARD, "id": ""}).json()["id"].startswith("checklist-")
    assert queue[0]["criterion_id"] == "c07" and queue[0]["title"] == "Завершение" and queue[0]["fragment"]
    aid = appeal.json()["id"]
    assert client.post(f"/api/appeals/{aid}/decision", json={"decision": "changed", "new_answer": "NA",
                                                             "decision_reason": "Клиент ушёл первым"}).status_code == 200
    ev = client.get(f"/api/evaluations/{eid}").json()
    assert ev["final_total"] == 90.00 and ev["ai_total"] == 85.50
    aid2 = client.post("/api/appeals", json={"evaluation_id": eid, "criterion_id": "c07", "comment": "всё же да"}).json()["id"]
    assert client.post(f"/api/appeals/{aid2}/decision", json={"decision": "changed", "new_answer": 7,
                                                              "decision_reason": "x"}).status_code == 422
    ev = client.post(f"/api/appeals/{aid2}/decision", json={"decision": "changed", "new_answer": "yes",
                                                            "decision_reason": "Есть прощание в u3"}).json()
    assert ev["final_total"] == 90.50 and ev["ai_total"] == 85.50
    c07 = next(r for r in ev["results"] if r["criterion_id"] == "c07")
    assert c07["ai_answer"] == "no" and c07["final_answer"] == "yes"
    assert client.post(f"/api/appeals/{aid2}/decision", json={"decision": "confirmed",
                                                              "decision_reason": "x"}).status_code == 409

    # новая версия чек-листа не трогает старую оценку
    client.put("/api/checklists/chat-quality", json=STANDARD)
    assert client.get(f"/api/evaluations/{eid}").json()["checklist_version"] == 1

    a = client.get("/api/analytics?group_id=G&checklist_id=chat-quality").json()
    assert a["evaluated"] == 1 and a["average_total"] == 90.5 and a["critical_count"] == 0
    assert a["appeals"] == {"total": 2, "open": 0, "confirmed": 0, "changed": 2}
    c06 = next(w for w in a["weak_criteria"] if w["criterion_id"] == "c06")
    assert c06["average_ratio"] == 0.7
    assert all(w["criterion_id"] != "c08" for w in a["weak_criteria"])
    assert a["by_language"] == [{"language": "RU", "count": 1, "average_total": 90.5}]


def test_mock_evaluator_and_cache(client):
    client.post("/api/conversations/upload?group_id=G", json=[_record("a"), _record("b")])
    client.post("/api/checklists", json=STANDARD)
    body = {"group_id": "G", "all": True, "checklist_id": "chat-quality"}
    job = _wait(client, client.post("/api/evaluations", json=body).json()["job_id"])
    assert (job["done"], job["failed"]) == (2, 0)
    again = client.post("/api/evaluations", json=body).json()
    assert again["reused"] == 2 and client.get(f"/api/jobs/{again['job_id']}").json()["status"] == "done"
    forced = client.post("/api/evaluations", json={**body, "force": True}).json()
    assert forced["reused"] == 0 and _wait(client, forced["job_id"])["done"] == 2
    ev = client.get(f"/api/evaluations/{client.get('/api/conversations?group_id=G').json()[0]['evaluation_id']}").json()
    assert ev["model"] == "mock" and len(ev["results"]) == 8
    assert all(e["id"] in ("u1", "u2", "u3") for r in ev["results"] for e in r["evidence"])


def test_import_accepts_request_url_only_for_organizer_host(client, monkeypatch):
    from backend import datasets
    seen = []

    class Resp:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"isSuccess": True, "data": {"records": [_record()], "total_records": 1}}

    monkeypatch.setattr(datasets.httpx, "get", lambda url, timeout: seen.append(url) or Resp())
    good = "https://x.a5.environment.api.powerplatform.com/run?sig=S&group_id=DEV"
    r = client.post("/api/datasets/import", json={"group_id": "NEW", "api_url": good})
    assert r.status_code == 200 and seen == ["https://x.a5.environment.api.powerplatform.com/run?sig=S&group_id=NEW"]
    for bad in ("http://x.api.powerplatform.com/run", "https://evil.example.com/run", "https://api.powerplatform.com.evil.com/run"):
        assert client.post("/api/datasets/import", json={"group_id": "NEW", "api_url": bad}).status_code == 422
    assert len(seen) == 1
