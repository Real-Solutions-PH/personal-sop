"""The one outbound call this module makes: the provider's ``GET /models``.

:data:`http_client` is the ONE substitution seam for tests: replace it with a
factory returning an ``httpx.Client`` on an ``httpx.MockTransport``. Nothing
else patches httpx.

The provider's response body is parsed and dropped here. It is never
returned, logged or attached to an error, because providers echo the key in
error bodies.
"""

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from app.modules.ai_providers.rules import (
    ModelInfo,
    VerifyCode,
    code_for_status,
    normalise_models,
)

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 10.0
MAX_BODY_BYTES = 5 * 1024 * 1024


def _default_client() -> httpx.Client:
    # Redirects are never followed: a 3xx would carry the key to another host.
    return httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False)


HttpClientFactory = Callable[[], httpx.Client]
http_client: HttpClientFactory = _default_client


@dataclass(frozen=True)
class ListOutcome:
    code: VerifyCode
    models: list[ModelInfo]
    truncated: bool = False


def _headers(provider: str, api_key: str) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
    if provider == "anthropic":
        # Anthropic's model listing authenticates with x-api-key.
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    return headers


def list_models(*, provider: str, base_url: str, api_key: str) -> ListOutcome:
    """Call ``GET {base_url}/models`` and classify the outcome."""
    try:
        with http_client() as client:
            resp = client.get(f"{base_url}/models", headers=_headers(provider, api_key))
    except (httpx.TransportError, httpx.InvalidURL):
        # Connect / read / timeout failures. The exception text can carry the
        # URL; only the class name is logged.
        logger.info("ai provider unreachable (%s)", provider)
        return ListOutcome("unreachable", [])
    code = code_for_status(resp.status_code)
    if code != "ok":
        logger.info("ai provider %s answered %s", provider, resp.status_code)
        return ListOutcome(code, [])
    if len(resp.content) > MAX_BODY_BYTES:
        return ListOutcome("bad_response", [])
    try:
        payload = json.loads(resp.content)
    except ValueError:
        return ListOutcome("bad_response", [])
    normalised = normalise_models(payload)
    if normalised is None:
        return ListOutcome("bad_response", [])
    models, truncated = normalised
    return ListOutcome("ok", models, truncated)
