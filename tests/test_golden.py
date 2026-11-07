"""eval_golden на тестовой базе с двумя оценками: цифры известны заранее. Модель — заглушка, сеть не нужна."""
import time

from tests import eval_golden
from tests.conftest import STANDARD
from tests.test_api import _record, _wait


def test_report_numbers(client):
    client.post("/api/conversations/upload?group_id=G", json=[_record("a"), _record("b")])
    client.post("/api/checklists", json={**STANDARD, "id": "std"})
    job = client.post("/api/evaluations", json={"group_id": "G", "all": True, "checklist_id": "std"}).json()
    _wait(client, job["job_id"])
    ai = {}
    for c in client.get("/api/conversations?group_id=G").json():
        ev = client.get(f"/api/evaluations/{c['evaluation_id']}").json()
        ai[c["conversation_id"]] = {r["criterion_id"]: r["ai_answer"] for r in ev["results"]}
    wrong = {**ai["b"], "c08": "yes" if ai["b"]["c08"] == "no" else "no"}  # разметка b расходится в одном критерии (грубая ошибка)
    golden = [{"group_id": "G", "conversation_id": "a", "answers": ai["a"]},
              {"group_id": "G", "conversation_id": "b", "answers": wrong},
              {"group_id": "G", "conversation_id": "c", "holdout": True, "answers": ai["a"]},
              {"group_id": "G", "conversation_id": "a", "example": True, "answers": ai["a"]}]
    rep = eval_golden.report("G", "std", golden=golden)
    n = len(ai["a"])
    assert rep["dialogs"] == 2 and rep["overall_pct"] == round(100 * (2 * n - 1) / (2 * n), 1)
    assert rep["by_criterion"]["c08"] == 50.0 and rep["by_criterion"]["c01"] == 100.0
    assert [m["criterion_id"] for m in rep["mismatches"]] == ["c08"]
    assert len(rep["critical_missed"]) + len(rep["critical_false"]) == 1
    assert rep["verified_quotes_pct"] == 100.0
    held = eval_golden.report("G", "std", holdout=True, golden=golden)
    assert held["not_evaluated"] == {"нет оценки": 1}
