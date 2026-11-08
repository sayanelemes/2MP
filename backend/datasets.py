"""Импорт диалогов: из API организаторов по group_id и из файла. Нормализация реплик."""
import hashlib
import json
import re
from contextlib import closing
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import quote, urlsplit

import httpx
from fastapi import HTTPException

from . import config, db

ROLES = {"client", "operator", "bot", "system"}
REQUIRED = ("conversation_id", "channel", "language", "transcript")


def _seconds(ts):
    """MM:SS (или H:MM:SS) -> секунды; иначе None."""
    if isinstance(ts, str) and re.fullmatch(r"\d+(:\d{1,2})+", ts.strip()):
        total = 0
        for part in ts.strip().split(":"):
            total = total * 60 + int(part)
        return total
    return None


def _iso(ts):
    try:
        # fromisoformat не везде принимает 7 знаков дроби: обрезаем до 6
        return datetime.fromisoformat(re.sub(r"(\.\d{6})\d+", r"\1", ts.strip()).replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return None


def normalize(record):
    """Проверяет запись и возвращает её с репликами u1.. и t в секундах. ValueError с понятным текстом."""
    if not isinstance(record, dict):
        raise ValueError("запись должна быть объектом")
    missing = [f for f in REQUIRED if record.get(f) in (None, "")]
    if missing:
        raise ValueError(f"{record.get('conversation_id', '?')}: нет полей {', '.join(missing)}")
    cid = record["conversation_id"]
    if not isinstance(record["transcript"], list) or not record["transcript"]:
        raise ValueError(f"{cid}: transcript должен быть непустым списком")
    base = None
    utterances = []
    for i, u in enumerate(record["transcript"], 1):
        if not isinstance(u, dict) or u.get("speaker") not in ROLES or not isinstance(u.get("text"), str):
            speaker = u.get("speaker") if isinstance(u, dict) else None
            raise ValueError(f"{cid}: реплика {i}: нужны text и speaker из {sorted(ROLES)}, получено {speaker!r}")
        ts = u.get("timestamp")
        t = _seconds(ts)
        if t is None:
            moment = _iso(ts)
            if moment is not None:
                base = base or moment
                try:
                    t = float(Decimal(str((moment - base).total_seconds())).quantize(Decimal("0.1"), ROUND_HALF_UP))
                except TypeError:  # смесь времени с зоной и без
                    t = None
        utterances.append({"id": f"u{i}", "t": t, "timestamp": ts, "speaker": u["speaker"], "text": u["text"]})
    return {
        "conversation_id": str(cid),
        "channel": record["channel"],
        "language": record["language"],
        "audio_url": record.get("audio_url") or None,
        "transcript": utterances,
    }


def extract_records(payload):
    """Одна запись, массив, полный ответ API или {records: [...]} -> список записей."""
    if isinstance(payload, dict) and "isSuccess" in payload:
        if not payload["isSuccess"]:
            raise HTTPException(502, f"API вернуло ошибку: {payload.get('error') or 'без текста'}")
        payload = payload.get("data") or {}
    if isinstance(payload, dict) and "records" in payload:
        payload = payload["records"]
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise HTTPException(422, "ожидается запись, массив записей или ответ API")
    return payload


def save_records(group_id, records):
    errors, normalized = [], []
    for i, rec in enumerate(records, 1):
        try:
            normalized.append(normalize(rec))
        except ValueError as e:
            errors.append(f"запись {i}: {e}")
    if errors:
        raise HTTPException(422, "; ".join(errors[:20]))
    with closing(db.connect()) as conn, conn:
        for r in normalized:
            transcript = json.dumps(r["transcript"], ensure_ascii=False)
            conn.execute(
                "INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?)"
                " ON CONFLICT(group_id, conversation_id) DO UPDATE SET channel=excluded.channel,"
                " language=excluded.language, transcript_json=excluded.transcript_json,"
                " audio_url=excluded.audio_url, content_hash=excluded.content_hash, imported_at=excluded.imported_at",
                (group_id, r["conversation_id"], r["channel"], r["language"], transcript, r["audio_url"],
                 hashlib.sha256(transcript.encode()).hexdigest(), db.now()))
    return len(normalized)


ALLOWED_API_HOSTS = (".api.powerplatform.com",)  # адрес из тела запроса: только API организаторов, иначе сервер станет прокси к любому адресу


def api_url(group_id, base=None):
    found = re.search(r"https?://[^\s\"'<>]+", base or "")  # вставку с кавычками, пробелами, переносами и лишним текстом чистим
    base = (found.group(0) if found else (base or "").strip()) or config.CQA_API_URL
    if not base:
        raise HTTPException(500, "CQA_API_URL не задан в .env")
    if base is not config.CQA_API_URL:
        parts = urlsplit(base)
        if parts.scheme != "https" or not (parts.hostname or "").endswith(ALLOWED_API_HOSTS):
            raise HTTPException(422, "Адрес API должен быть https-ссылкой организаторов (…api.powerplatform.com)")
    value = "group_id=" + quote(group_id, safe="")
    url, n = re.subn(r"(?<=[?&])group_id=[^&]*", lambda _: value, base)
    return url if n else url + ("&" if "?" in url else "?") + value


def import_group(group_id, base_url=None):
    try:
        resp = httpx.get(api_url(group_id, base_url), timeout=60)
        resp.raise_for_status()
        payload = resp.json()
    except httpx.HTTPStatusError as e:
        code = e.response.status_code  # без адреса в тексте: в нём подпись
        hint = f": у организаторов нет набора group_id={group_id!r}, используйте DEV, FBroker или Swap" if code == 404 else ""
        raise HTTPException(502, f"API ответило {code}{hint}")
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(502, f"API недоступно: {type(e).__name__}")
    records = extract_records(payload)
    total = (payload.get("data") or {}).get("total_records", len(records)) if isinstance(payload, dict) else len(records)
    return {"imported": save_records(group_id, records), "total": total}
