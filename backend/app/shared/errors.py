"""Standard JSON error envelope (constitution §3.6).

Every error response from the API uses the shape
``{"code": <str>, "message": <str>, "details": <Any | None>}``.
"""

import logging
from collections.abc import Mapping
from http import HTTPStatus
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


class ErrorResponse(BaseModel):
    """Standard error envelope returned by all API error responses."""

    code: str
    message: str
    details: Any | None = None


def code_for_status(status_code: int) -> str:
    """Map an HTTP status code to a stable machine-readable error code."""
    if status_code == 422:
        return "validation_error"
    if status_code == 500:
        return "internal_error"
    try:
        return HTTPStatus(status_code).name.lower()
    except ValueError:
        return "error"


def _envelope_response(
    status_code: int,
    code: str,
    message: str,
    details: Any | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(code=code, message=message, details=details).model_dump(),
        headers=headers,
    )


async def http_exception_handler(
    _request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        code = detail.get("code") or code_for_status(exc.status_code)
        message = detail.get("message") or str(detail)
        details = jsonable_encoder(detail.get("details"))
    else:
        code = code_for_status(exc.status_code)
        message = str(detail)
        details = None
    return _envelope_response(exc.status_code, code, message, details, exc.headers)


async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Only expose loc/msg/type: pydantic's errors() also carries "input"
    # (the submitted value — passwords on a failed login/signup) and "ctx"
    # (which can embed exception objects). Neither may leave the server.
    safe_details = [
        {"loc": err.get("loc"), "msg": err.get("msg"), "type": err.get("type")}
        for err in exc.errors()
    ]
    return _envelope_response(
        422,
        "validation_error",
        "Validation failed",
        jsonable_encoder(safe_details),
    )


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    # Registering an Exception handler stops ServerErrorMiddleware from
    # printing the traceback, so log it here; the envelope never carries
    # exception internals in any environment.
    logger.exception("Unhandled exception", exc_info=exc)
    # This handler runs outside CORSMiddleware, so CORS headers must be
    # echoed manually or browsers hide the 500 response body entirely.
    headers: dict[str, str] = {"Vary": "Origin"}
    origin = request.headers.get("origin")
    if origin and origin in settings.all_cors_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    return _envelope_response(
        500, "internal_error", "Internal server error", None, headers
    )


def register_exception_handlers(app: FastAPI) -> None:
    # ``add_exception_handler`` types its handler as taking a bare Exception;
    # cast keeps mypy strict (and ty) happy with the narrower handler types.
    app.add_exception_handler(StarletteHTTPException, cast(Any, http_exception_handler))
    app.add_exception_handler(
        RequestValidationError, cast(Any, validation_exception_handler)
    )
    app.add_exception_handler(Exception, unhandled_exception_handler)
