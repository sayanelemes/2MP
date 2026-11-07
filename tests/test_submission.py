"""Проверки results/dev|prod/results.json по правилам приложения к гайду (JSON 1.0). Запуск: pytest tests/test_submission.py."""
import json
import sqlite3
from fractions import Fraction
from pathlib import Path

import pytest

from backend import config

ROOT = Path(__file__).resolve().parent.parent
CODES = ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"]
WEIGHT = {"contact": 10, "discovery": 15, "identification": 20, "consultation": 20, "empathy": 15, "dialogue": 15, "closure": 5}
SCALE = {"consultation": ([0, 5, 10, 15, 20], 20), "dialogue": ([0, 4, 7, 10], 10)}  # значения шкалы и максимум
NULLABLE = {"discovery", "identification", "consultation", "closure"}
FOLDERS = [pytest.param(f, id=f) for f in ("dev", "prod")]


def load(folder):
    path = ROOT / "results" / folder / "results.json"
    if not path.exists():
        pytest.skip(f"{path.relative_to(ROOT)} ещё нет")
    return json.loads(path.read_text(encoding="utf-8"))  # UTF-8, без комментариев и лишних запятых


def score(values):
    """Итог 0–100: N/A исключается, вес перераспределяется между применимыми."""
    got = total = Fraction(0)
    for code, w in WEIGHT.items():
        v = values[code]
        if v is None:
            continue
        total += w
        if code in SCALE:
            got += Fraction(v, SCALE[code][1]) * w
        else:
            got += w if v else 0
    return float(round(got / total * 100, 2)) if total else None


def test_spec_example():
    v = {"contact": True, "discovery": None, "identification": None, "consultation": 15, "empathy": True,
         "dialogue": 7, "closure": True}
    assert score(v) == 85.38  # пример из приложения


@pytest.mark.parametrize("folder", FOLDERS)
def test_structure(folder):
    doc = load(folder)
    assert doc["schema_version"] == "1.0" and doc["team_name"].strip()
    assert doc["model"]["mode"] in ("local", "external_api", "hybrid") and doc["model"]["name"].strip()
    ids = [r["conversation_id"] for r in doc["results"]]
    assert len(ids) == len(set(ids)), "повторяются conversation_id"
    if folder == "prod":
        assert len(ids) == 10, "в prod ровно 10 записей, включая ошибки"
    for r in doc["results"]:
        if r["status"] == "error":
            assert r["criteria"] == [] and r["score"] is None and r["error"], r["conversation_id"]
            continue
        assert r["status"] == "ok", r["conversation_id"]
        assert [c["criterion_id"] for c in r["criteria"]] == CODES, r["conversation_id"]
        assert set(r["score"]) == {"final_score", "critical_flag"}


@pytest.mark.parametrize("folder", FOLDERS)
def test_values_and_score(folder):
    for r in (r for r in load(folder)["results"] if r["status"] == "ok"):
        values = {c["criterion_id"]: c["value"] for c in r["criteria"]}
        for code, v in values.items():
            where = f"{r['conversation_id']}/{code}"
            if code in SCALE:
                assert v is None and code in NULLABLE or (type(v) is int and v in SCALE[code][0]), where
            elif code in NULLABLE:
                assert v is None or isinstance(v, bool), where
            else:
                assert isinstance(v, bool), where  # contact, empathy, critical: без N/A
        s = r["score"]
        assert s["critical_flag"] is values["critical"], r["conversation_id"]
        assert abs(s["final_score"] - score(values)) <= 0.011, r["conversation_id"]  # половина копейки: round() у разных реализаций идёт в разные стороны
        assert all(c["rationale"].strip() for c in r["criteria"]), r["conversation_id"]


@pytest.mark.parametrize("folder", FOLDERS)
def test_ids_and_turns_match_dataset(folder):
    """ID и номера реплик (с 1, по всему транскрипту) должны совпадать с набором в базе."""
    doc = load(folder)
    db = Path(config.DB_PATH)
    if not db.exists():
        pytest.skip("нет cqa.db")
    group = "DEV" if folder == "dev" else None
    with sqlite3.connect(db) as conn:
        sizes = {cid: len(json.loads(t)) for cid, t in conn.execute(
            "SELECT conversation_id, transcript_json FROM conversations" + (" WHERE group_id=?" if group else ""),
            (group,) if group else ())}
    if folder == "prod" and not sizes:
        pytest.skip("контрольный набор не загружен")
    assert {r["conversation_id"] for r in doc["results"]} == set(sizes) if group else True
    for r in doc["results"]:
        assert r["conversation_id"] in sizes, r["conversation_id"]
        for c in r["criteria"]:
            assert all(isinstance(n, int) and 1 <= n <= sizes[r["conversation_id"]] for n in c["evidence_turns"]), \
                f"{r['conversation_id']}/{c['criterion_id']}"


def test_dev_has_65_with_calls():
    assert len(load("dev")["results"]) == 65  # 60 чатов и 5 звонков


@pytest.mark.parametrize("folder", FOLDERS)
def test_real_model_not_mock(folder):
    """Заглушка не должна попасть в сдачу: это не оценка, а шаблон."""
    assert "mock" not in load(folder)["model"]["name"].lower().split(", ")


def test_expected_turns_from_checked_range():
    """«Нет» без цитаты: номера из checked_range, оператор в приоритете, не больше 5, нумерация с 1."""
    from backend.export_results import expected_turns
    tr = [{"id": f"u{i}", "speaker": "operator" if i % 2 else "client"} for i in range(1, 21)]
    assert expected_turns(tr, {"from": "u1", "to": "u3"}) == [1, 3]
    assert expected_turns(tr, {"from": "u1", "to": "u20"}) == [11, 13, 15, 17, 19]
    assert expected_turns(tr, None) == [] and expected_turns(tr, {"from": "x", "to": "u3"}) == []


@pytest.mark.parametrize("folder", FOLDERS)
def test_no_answer_has_evidence_turns(folder):
    """Для «Нет» указано место, где действие ожидалось (когда у ИИ есть цитата или checked_range)."""
    doc = load(folder)
    empty = [(r["conversation_id"], c["criterion_id"]) for r in doc["results"] if r["status"] == "ok"
             for c in r["criteria"] if c["value"] is False and not c["evidence_turns"]]
    assert not empty, empty
