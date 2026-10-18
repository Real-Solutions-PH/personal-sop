"""Shared calls and the provider seam for the AI providers API tests."""

from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.modules.ai_providers import provider_http

API = f"{settings.API_V1_STR}/ai"

Handler = Callable[[httpx.Request], httpx.Response]


class Provider:
    """The fake provider behind ``provider_http.http_client``.

    ``respond`` decides each answer; every request is kept in ``seen``.
    """

    def __init__(self) -> None:
        self.seen: list[httpx.Request] = []
        self.respond: Handler = lambda r: httpx.Response(
            200, json={"data": [{"id": "gpt-4o"}]}
        )

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        return self.respond(request)

    def client(self) -> httpx.Client:
        return httpx.Client(
            transport=httpx.MockTransport(self._handle), follow_redirects=False
        )


@pytest.fixture
def provider(monkeypatch: pytest.MonkeyPatch) -> Iterator[Provider]:
    fake = Provider()
    monkeypatch.setattr(provider_http, "http_client", fake.client)
    yield fake


class AI:
    """One signed-in user's AI providers API. Every response is kept so a
    test can assert something never appeared in any of them."""

    def __init__(self, client: TestClient, headers: dict[str, str]) -> None:
        self.c = client
        self.h = headers
        self.texts: list[str] = []

    def _go(self, method: str, path: str, status: int, **kw: Any) -> Any:
        r = self.c.request(method, f"{API}{path}", headers=self.h, **kw)
        self.texts.append(r.text)
        assert r.status_code == status, r.text
        return r.json() if r.content else None

    def get(self, path: str, status: int = 200, **params: Any) -> Any:
        return self._go("GET", path, status, params=params)

    def post(self, path: str, body: Any = None, status: int = 200) -> Any:
        return self._go("POST", path, status, json=body if body is not None else {})

    def patch(self, path: str, body: Any, status: int = 200) -> Any:
        return self._go("PATCH", path, status, json=body)

    def put(self, path: str, body: Any, status: int = 200) -> Any:
        return self._go("PUT", path, status, json=body)

    def delete(self, path: str, status: int = 204) -> Any:
        return self._go("DELETE", path, status)

    def credential(
        self, provider: str = "openai", key: str = "sk-test-0000-abcd", **extra: Any
    ) -> dict[str, Any]:
        body = {"provider": provider, "api_key": key, **extra}
        return dict(self.post("/providers", body, status=201))
