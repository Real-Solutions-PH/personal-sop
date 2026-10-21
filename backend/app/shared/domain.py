"""Domain errors with stable machine-readable codes.

Services raise these; the error-envelope handler (``app.shared.errors``)
renders ``{code, message, details}``. Messages are written for a person and
never interpolate submitted values or exception text.
"""

from typing import Any

from fastapi import HTTPException


def domain_error(
    status: int, code: str, message: str, details: Any | None = None
) -> HTTPException:
    return HTTPException(
        status_code=status,
        detail={"code": code, "message": message, "details": details},
    )


def not_found(what: str) -> HTTPException:
    return domain_error(
        404, f"{what}_not_found", f"{what.replace('_', ' ').capitalize()} not found"
    )


def conflict(code: str, message: str, details: Any | None = None) -> HTTPException:
    return domain_error(409, code, message, details)


def invalid(code: str, message: str, details: Any | None = None) -> HTTPException:
    return domain_error(422, code, message, details)
