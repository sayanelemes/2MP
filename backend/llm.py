"""Весь вызов модели. Смена провайдера — только через .env (LLM_PROVIDER, LLM_MODEL, ключ)."""
import threading
import time

import httpx

from . import config

DEFAULT_MODELS = {"gemini": "gemini-3.6-flash", "groq": "openai/gpt-oss-120b", "anthropic": "claude-haiku-5-5", "mock": "mock"}


class LLMError(Exception):
    def __init__(self, message, retryable=False, retry_after=None, status=None):
        super().__init__(message)
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after


_used = threading.local()  # модель, которая реально ответила в этом потоке
_blocked = {}  # провайдер -> до какого момента пропускаем после 429/5xx
COOLDOWN = 60


def _model(provider):
    return (config.LLM_MODEL if provider == config.LLM_PROVIDER else "") or DEFAULT_MODELS.get(provider, provider)


def model_name():
    return getattr(_used, "model", None) or _model(config.LLM_PROVIDER)


def _post(url, headers, body):
    try:
        resp = httpx.post(url, headers=headers, json=body, timeout=180)
    except httpx.HTTPError as e:
        raise LLMError(f"сеть: {type(e).__name__}", retryable=True)
    if resp.status_code == 429 or resp.status_code >= 500:
        retry_after = resp.headers.get("retry-after")
        raise LLMError(f"провайдер ответил {resp.status_code}", retryable=True, status=resp.status_code,
                       retry_after=float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else None)
    if resp.status_code != 200:
        raise LLMError(f"провайдер ответил {resp.status_code}: {resp.text[:300]}")
    return resp.json()


def _keys(provider):
    """Ключи провайдера: в .env можно перечислить несколько через запятую (для Gemini — из разных проектов Google: квота общая на проект)."""
    raw = {"gemini": config.GEMINI_API_KEY, "groq": config.GROQ_API_KEY, "anthropic": config.ANTHROPIC_API_KEY}.get(provider, "")
    return [k.strip() for k in raw.split(",") if k.strip()] or [""]


def _generate(provider, key, system, user, schema):
    if provider == "gemini":
        if not key:
            raise LLMError("GEMINI_API_KEY не задан в .env")
        data = _post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{_model(provider)}:generateContent",
            {"x-goog-api-key": key},  # ключ в заголовке, а не в адресе: не попадёт в логи
            {"systemInstruction": {"parts": [{"text": system}]},
             "contents": [{"role": "user", "parts": [{"text": user}]}],
             "generationConfig": {"temperature": 0, "responseMimeType": "application/json",
                                  "responseJsonSchema": schema}})
        try:
            return "".join(p.get("text", "") for p in data["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError):
            raise LLMError(f"пустой ответ модели: {str(data)[:300]}")
    if provider == "groq":
        if not key:
            raise LLMError("GROQ_API_KEY не задан в .env")
        data = _post(
            "https://api.groq.com/openai/v1/chat/completions",
            {"Authorization": f"Bearer {key}"},
            {"model": _model(provider), "temperature": 0, "response_format": {"type": "json_object"},
             "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError):
            raise LLMError(f"пустой ответ модели: {str(data)[:300]}")
    if provider == "anthropic":
        if not key:
            raise LLMError("ANTHROPIC_API_KEY не задан в .env")
        data = _post(  # без temperature: на новых моделях Claude нестандартное значение даёт 400; JSON требует системный промпт
            "https://api.anthropic.com/v1/messages",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
            {"model": _model(provider), "max_tokens": 16000, "system": system,
             "messages": [{"role": "user", "content": user}]})
        text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
        if not text:
            raise LLMError(f"пустой ответ модели: {str(data)[:300]}")
        return text
    raise LLMError(f"неизвестный LLM_PROVIDER: {provider}")


def generate_json(system: str, user: str, schema: dict) -> str:
    """Один запрос, temperature 0, ответ — строка JSON. При 429/5xx берёт следующий ключ или провайдера из LLM_PROVIDER."""
    last, waits = None, []
    slots = [(p, k) for p in config.LLM_PROVIDERS for k in _keys(p)]
    for slot in sorted(slots, key=lambda sl: _blocked.get(sl, 0) > time.monotonic()):  # слоты в паузе — в конец
        provider, key = slot
        try:
            out = _generate(provider, key, system, user, schema)
        except LLMError as e:
            last = e if e.retryable or last is None else last  # повторяемая ошибка важнее: она запускает повторы
            if e.retryable:
                _blocked[slot] = time.monotonic() + (e.retry_after or COOLDOWN)
                waits.append(e.retry_after or COOLDOWN)
            continue  # нет ключа, 429 или 5xx: пробуем следующего
        _used.model = _model(provider)
        return out
    if waits and last.retryable:
        last.retry_after = min(waits)  # ждать до ближайшего освободившегося слота, а не до самого долгого
    raise last
