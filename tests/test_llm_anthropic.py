"""Провайдер anthropic без сети: клиент подменён заглушкой."""
from types import SimpleNamespace as NS

import anthropic
import httpx
import pytest

from backend import config, llm, prompts


class FakeClient:
    def __init__(self, response=None, error=None):
        self.calls, self.response, self.error = [], response, error
        self.messages = NS(create=self.create)

    def create(self, **kw):
        self.calls.append(kw)
        if self.error:
            raise self.error
        return self.response


def reply(stop="end_turn", blocks=None):
    blocks = blocks or [NS(type="thinking", thinking=""), NS(type="text", text='{"results": []}')]
    return NS(stop_reason=stop, content=blocks, usage=NS(input_tokens=10, output_tokens=5))


@pytest.fixture
def use(monkeypatch):
    def _use(client, key="k"):
        monkeypatch.setattr(config, "ANTHROPIC_API_KEY", key)
        monkeypatch.setattr(llm, "_anthropic_clients", {key: client})
    return _use


def status_error(cls, code, headers=None):
    resp = httpx.Response(code, headers=headers or {}, request=httpx.Request("POST", "https://x"))
    return cls("boom", response=resp, body=None)


def test_success_skips_thinking_block_and_sends_haiku_params(use):
    c = FakeClient(reply())
    use(c)
    assert llm._generate("anthropic", "k", "sys", "usr", prompts.SCHEMA) == '{"results": []}'
    kw = c.calls[0]
    assert kw["model"] == "claude-haiku-5-5" and kw["system"] == "sys"
    assert not {"temperature", "top_p", "top_k", "thinking"} & set(kw)
    assert kw["output_config"]["effort"] == config.LLM_EFFORT
    assert kw["output_config"]["format"]["type"] == "json_schema"


def test_strict_schema_closes_objects_and_makes_null_variants():
    s = llm.strict_schema(prompts.SCHEMA)
    item = s["properties"]["results"]["items"]
    assert s["additionalProperties"] is False and item["additionalProperties"] is False
    assert item["properties"]["evidence"]["items"]["additionalProperties"] is False
    cr = item["properties"]["checked_range"]
    assert {"type": "null"} in cr["anyOf"] and cr["anyOf"][0]["additionalProperties"] is False
    assert prompts.SCHEMA["properties"]["results"]["items"]["properties"]["checked_range"]["type"] == ["object", "null"]


@pytest.mark.parametrize("stop", ["refusal", "max_tokens"])
def test_refusal_and_truncation_are_errors(use, stop):
    use(FakeClient(reply(stop)))
    with pytest.raises(llm.LLMError) as e:
        llm._generate("anthropic", "k", "s", "u", {})
    assert not e.value.retryable


def test_rate_limit_keeps_retry_after(use):
    use(FakeClient(error=status_error(anthropic.RateLimitError, 429, {"retry-after": "7"})))
    with pytest.raises(llm.LLMError) as e:
        llm._generate("anthropic", "k", "s", "u", {})
    assert e.value.retryable and e.value.retry_after == 7


def test_auth_error_message_has_no_key(use):
    use(FakeClient(error=status_error(anthropic.AuthenticationError, 401)), key="sk-ant-secret")
    with pytest.raises(llm.LLMError) as e:
        llm._generate("anthropic", "sk-ant-secret", "s", "u", {})
    assert "sk-ant-secret" not in str(e.value) and not e.value.retryable


def test_missing_key_fails_before_network(monkeypatch):
    monkeypatch.setattr(llm, "_anthropic_clients", {})
    with pytest.raises(llm.LLMError, match="ANTHROPIC_API_KEY"):
        llm._generate("anthropic", "", "s", "u", {})
