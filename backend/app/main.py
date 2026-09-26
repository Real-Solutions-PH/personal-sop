from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api import v1_router
from app.core.config import settings
from app.core.observability import scrub_event
from app.core.rls import check_rls_posture
from app.core.storage import ensure_bucket
from app.logger import app_logger
from app.shared.errors import ErrorResponse, register_exception_handlers


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


# Baseline security headers set on every response (§3 AppSec). Values are
# static; only CSP varies (docs pages need their asset CDN) and HSTS is added
# outside local, where the app is served over HTTPS.
_STATIC_SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "permissions-policy": "geolocation=(), microphone=(), camera=(), browsing-topics=()",
}
# JSON API responses reference nothing, so lock the CSP right down.
_API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
# Swagger UI / ReDoc (local only) pull their bundle from jsDelivr.
_DOCS_CSP = (
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; "
    "style-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com 'unsafe-inline'; "
    "img-src 'self' https://fastapi.tiangolo.com data:; "
    "font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com; "
    "worker-src 'self' blob:"
)
_DOCS_PATHS = {"/docs", "/redoc"}
_HSTS = "max-age=63072000; includeSubDomains"


class SecurityHeadersMiddleware:
    """Pure-ASGI middleware that stamps security headers on every response.

    ASGI (not BaseHTTPMiddleware) so it only touches the response-start
    message and never buffers the body — safe for the streaming SSE routes.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope.get("path", "")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(raw=message["headers"])
                for name, value in _STATIC_SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                headers.setdefault(
                    "content-security-policy",
                    _DOCS_CSP if path in _DOCS_PATHS else _API_CSP,
                )
                if settings.ENVIRONMENT != "local":
                    headers.setdefault("strict-transport-security", _HSTS)
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodySizeLimitMiddleware:
    """Reject requests whose body exceeds ``max_request_body_size_bytes``.

    Fast-rejects on a declared Content-Length, and also counts streamed bytes
    so a chunked or mis-declared body cannot exhaust worker memory. The limit
    is read from settings per request so it stays overridable in tests.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        max_bytes = settings.max_request_body_size_bytes
        content_length = Headers(scope=scope).get("content-length")
        if content_length is not None and content_length.isdigit():
            if int(content_length) > max_bytes:
                await self._reject(send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > max_bytes:
                    # Raised inside the app call, so the app's own exception
                    # handler turns it into a proper 413 (envelope + headers).
                    raise HTTPException(
                        status_code=413, detail="Request body too large"
                    )
            return message

        await self.app(scope, limited_receive, send)

    @staticmethod
    async def _reject(send: Send) -> None:
        # Fast path runs outside the app, so emit the envelope directly with
        # the same code the app's HTTP handler would produce for a 413.
        body = (
            b'{"code":"request_entity_too_large",'
            b'"message":"Request body too large","details":null}'
        )
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(
        dsn=str(settings.SENTRY_DSN),
        enable_tracing=True,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        # Don't ship exception frame locals: verify_token/get_bearer_token hold
        # the raw JWT in a local, which would otherwise leak on any uncaught
        # error (frame locals are captured independently of send_default_pii).
        include_local_variables=False,
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Object storage is only used by OCR. When it is enabled, ensure its
    # bucket — but an unreachable store must degrade OCR, not kill startup.
    if settings.OCR_ENABLED:
        try:
            ensure_bucket(settings.OCR_BUCKET)
        except Exception:
            app_logger.warning(
                "OCR object storage unreachable at startup; OCR uploads will "
                "fail until it recovers",
                exc_info=True,
            )
    check_rls_posture()
    # Open the jobs queue connector so routes can enqueue tasks; the worker
    # process opens its own. Skipped entirely when the module is disabled.
    if settings.JOBS_ENABLED:
        from app.modules.jobs.app import jobs_app

        async with jobs_app.open_async():
            yield
    else:
        yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=(
        f"{settings.API_V1_STR}/openapi.json" if settings.docs_enabled else None
    ),
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

register_exception_handlers(app)
# Added inner-first: SecurityHeaders wraps BodySizeLimit so even a 413 carries
# the security headers.
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(
    v1_router,
    prefix=settings.API_V1_STR,
    responses={"4XX": {"model": ErrorResponse}},
)


def custom_openapi() -> dict[str, Any]:
    """OpenAPI schema with error responses using the §3.6 envelope.

    FastAPI hardcodes ``HTTPValidationError`` as the 422 response model;
    alias it to ``ErrorResponse`` so generated clients type every error
    response as the standard envelope.
    """
    if app.openapi_schema:
        return app.openapi_schema
    schema = original_openapi()
    schemas = schema.get("components", {}).get("schemas", {})
    if "HTTPValidationError" in schemas and "ErrorResponse" in schemas:
        schemas["HTTPValidationError"] = {"$ref": "#/components/schemas/ErrorResponse"}
        schemas.pop("ValidationError", None)
    app.openapi_schema = schema
    return schema


original_openapi = app.openapi
app.openapi = custom_openapi  # type: ignore[method-assign]

if settings.AI_ENABLED:
    from app.modules.ai.copilotkit import setup_copilotkit

    setup_copilotkit(app)
