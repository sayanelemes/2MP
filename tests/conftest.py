import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import config, evaluator, main
from tests.stub import stub

STANDARD = json.loads((Path(__file__).parent / "checklist_standard.json").read_text(encoding="utf-8"))
ROW1 = {"c01": "yes", "c02": "yes", "c03": "yes", "c04": 15, "c05": "yes", "c06": 7, "c07": "no", "c08": "no"}


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.setattr(config, "NA_EVIDENCE", False)  # .env разработчика не должен менять результат тестов


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setattr(config, "SEED_CHECKLIST", tmp_path / "none.json")
    monkeypatch.setattr(config, "LLM_PROVIDER", "mock")  # тесты не ходят в сеть
    monkeypatch.setattr(config, "LLM_MODEL", "")
    monkeypatch.setattr(evaluator, "PROMPT_VERSION", "mock")
    monkeypatch.setattr(evaluator, "_stub", stub)
    with TestClient(main.app) as c:
        yield c
