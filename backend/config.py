"""Настройки из .env (без сторонних библиотек)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_env = ROOT / ".env"
if _env.exists():
    for line in _env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.split(" #")[0].strip())  # " # ..." — комментарий

CQA_API_URL = os.environ.get("CQA_API_URL", "")
DB_PATH = str(ROOT / os.environ.get("DB_PATH", "cqa.db"))
LLM_PROVIDERS = [p.strip() for p in (os.environ.get("LLM_PROVIDER", "").lower() or "mock").split(",") if p.strip()]  # mock | gemini | groq; список = запасные при 429/5xx
LLM_PROVIDER = LLM_PROVIDERS[0]
LLM_MODEL = os.environ.get("LLM_MODEL", "").strip()
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
LLM_RPM = float(os.environ.get("LLM_RPM") or 5)
LLM_CONCURRENCY = int(os.environ.get("LLM_CONCURRENCY") or 1)
# звонки не отправляем в бесплатный сервис, пока организаторы не разрешат
LLM_ALLOW_VOICE = os.environ.get("LLM_ALLOW_VOICE", "").strip().lower() in ("1", "true", "yes")
FRONTEND_DIR = ROOT / "frontend"
SEED_CHECKLIST = Path(__file__).resolve().parent / "seed_checklist.json"
