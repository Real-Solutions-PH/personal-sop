"""The outbound seam through httpx.MockTransport: every outcome code, the
headers sent, and that nothing of the body reaches the log."""

import logging
from collections.abc import Callable, Iterator

import httpx
import pytest

from app.modules.ai_providers import provider_http

KEY = "sk-unit-SECRET-0123456789"
Handler = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def transport(monkeypatch: pytest.MonkeyPatch) -> Iterator[list[Handler]]:
    slot: list[Handler] = []

    def factory() -> httpx.Client:
        return httpx.Client(
            transport=httpx.MockTransport(lambda r: slot[0](r)),
            follow_redirects=False,
        )

    monkeypatch.setattr(provider_http, "http_client", factory)
    yield slot


def _call(provider: str = "openai") -> provider_http.ListOutcome:
    return provider_http.list_models(
        provider=provider, base_url="https://api.example.com/v1", api_key=KEY
    )


def test_ok_sends_bearer_to_models(transport: list[Handler]) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, json={"data": [{"id": "gpt-4o"}]})

    transport.append(handler)
    out = _call()
    assert out.code == "ok"
    assert [m.id for m in out.models] == ["gpt-4o"]
    assert str(seen[0].url) == "https://api.example.com/v1/models"
    assert seen[0].method == "GET"
    assert seen[0].headers["authorization"] == f"Bearer {KEY}"
    assert "x-api-key" not in seen[0].headers


def test_anthropic_also_sends_x_api_key(transport: list[Handler]) -> None:
    seen: list[httpx.Request] = []

    def handler(r: httpx.Request) -> httpx.Response:
        seen.append(r)
        return httpx.Response(200, json={"data": []})

    transport.append(handler)
    assert _call("anthropic").code == "ok"
    assert seen[0].headers["x-api-key"] == KEY
    assert seen[0].headers["anthropic-version"]


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "unauthorized"),
        (403, "unauthorized"),
        (404, "not_found"),
        (429, "rate_limited"),
        (500, "bad_response"),
        (302, "bad_response"),
    ],
)
def test_status_codes(
    transport: list[Handler], status: int, code: str, caplog: pytest.LogCaptureFixture
) -> None:
    # Providers echo the key in error bodies: the body must go nowhere.
    transport.append(
        lambda r: httpx.Response(
            status,
            json={"error": f"Incorrect API key provided: {KEY}"},
            headers={"location": "https://elsewhere.example/"},
        )
    )
    with caplog.at_level(logging.DEBUG):
        out = _call()
    assert out.code == code and out.models == []
    assert KEY not in caplog.text
    assert "Incorrect API key" not in caplog.text


def test_redirect_is_not_followed(transport: list[Handler]) -> None:
    hosts: list[str] = []

    def handler(r: httpx.Request) -> httpx.Response:
        hosts.append(r.url.host)
        return httpx.Response(307, headers={"location": "https://evil.example/models"})

    transport.append(handler)
    assert _call().code == "bad_response"
    assert hosts == ["api.example.com"]


@pytest.mark.parametrize(
    "exc",
    [
        httpx.ConnectError("boom"),
        httpx.ReadTimeout("slow"),
        httpx.ConnectTimeout("slow"),
        httpx.RemoteProtocolError("bad"),
    ],
)
def test_transport_errors_are_unreachable(
    transport: list[Handler], exc: Exception, caplog: pytest.LogCaptureFixture
) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        raise exc

    transport.append(handler)
    with caplog.at_level(logging.DEBUG):
        assert _call().code == "unreachable"
    assert KEY not in caplog.text


@pytest.mark.parametrize(
    "body",
    [b"<html>not json</html>", b'{"error": "x"}', b"[1, 2", b'"text"'],
)
def test_unparseable_ok_is_bad_response(transport: list[Handler], body: bytes) -> None:
    transport.append(lambda r: httpx.Response(200, content=body))
    assert _call().code == "bad_response"


def test_oversized_body_is_bad_response(transport: list[Handler]) -> None:
    big = b'{"data": [' + b" " * (provider_http.MAX_BODY_BYTES + 1) + b"]}"
    transport.append(lambda r: httpx.Response(200, content=big))
    assert _call().code == "bad_response"
