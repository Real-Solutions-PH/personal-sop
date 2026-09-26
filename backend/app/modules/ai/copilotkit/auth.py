"""Bearer-token guard for the AG-UI chat mount.

Mount-wide signature gate: a cheap, DB-free reject of anonymous or
bad-signature requests across every route under the chat mount (including
the info route), sitting outside CORSMiddleware so its own error responses
can echo CORS. It does NOT load the user — the run routes carry per-route
deps (``TenantDep`` + ``rate_limited``, see ``routes``) that re-check
``is_active``, provision the caller, and meter per-tenant AI spend. Keep
that deeper enforcement on the routes; this layer stays signature-only.
"""

from collections.abc import Awaitable, Callable

import jwt
from fastapi import FastAPI, Request, Response, status
from fastapi.responses import JSONResponse

from app.core import supabase_auth
from app.core.config import settings

from .paths import COPILOTKIT_PATH


def _envelope(
    status_code: int, code: str, message: str, request: Request
) -> JSONResponse:
    headers: dict[str, str] = {"Vary": "Origin"}
    if status_code == 401:
        headers["WWW-Authenticate"] = "Bearer"
    # This middleware sits OUTSIDE CORSMiddleware, so error responses must
    # echo CORS themselves or the browser can't read them (same pattern as
    # the 500 handler in app/shared/errors.py).
    origin = request.headers.get("origin")
    if origin and origin in settings.all_cors_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "details": None},
        headers=headers,
    )


def _auth_failure_response(request: Request) -> JSONResponse | None:
    """Return an error envelope if the bearer token doesn't authenticate.

    None means the token verified. A JWKS connection failure is surfaced
    as 503 (upstream outage), not 401 — same distinction as
    ``get_current_user``.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return _envelope(
            status.HTTP_401_UNAUTHORIZED, "unauthorized", "Not authenticated", request
        )
    try:
        supabase_auth.verify_token(auth.removeprefix("Bearer "))
    except jwt.exceptions.PyJWKClientConnectionError:
        return _envelope(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "auth_unavailable",
            "Authentication service unavailable",
            request,
        )
    except jwt.PyJWTError:
        return _envelope(
            status.HTTP_401_UNAUTHORIZED, "unauthorized", "Not authenticated", request
        )
    return None


def install_copilotkit_auth(app: FastAPI) -> None:
    """Require a valid bearer token on every route under the chat mount."""

    @app.middleware("http")
    async def copilotkit_auth(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # CORS preflights carry no Authorization header and must reach
        # CORSMiddleware (which sits INSIDE this middleware) untouched.
        if request.method != "OPTIONS" and request.url.path.startswith(COPILOTKIT_PATH):
            failure = _auth_failure_response(request)
            if failure is not None:
                return failure
        return await call_next(request)
