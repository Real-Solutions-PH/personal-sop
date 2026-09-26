"""Sentry event scrubbing (defense-in-depth for auth secrets).

Installed as both ``before_send`` and ``before_send_transaction`` on the Sentry
SDK so that, regardless of the ``send_default_pii`` setting, neither error nor
transaction events carry the Supabase auth cookie or the ``Authorization``
header. The scrubber only reads ``event["request"]``, so the same function
serves both hooks. See ticket #71.
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sentry_sdk._types import Event, Hint

# The single, explicit Supabase auth-cookie name shared by every client
# (see ``frontend/src/lib/supabase/cookie.ts``). ``@supabase/ssr`` splits large
# sessions into chunks named ``sb-app-auth.0``, ``sb-app-auth.1``, … so we
# match on the prefix rather than the exact name.
AUTH_COOKIE_NAME = "sb-app-auth"


def _is_auth_cookie(name: str) -> bool:
    return name.startswith(AUTH_COOKIE_NAME)


def _sanitize_cookie_header(value: str) -> str | None:
    """Drop ``sb-app-auth*`` pairs from a raw ``Cookie`` header string.

    Returns the remaining header, or ``None`` when nothing is left (so the
    caller can drop the header entirely).
    """
    kept = [
        pair
        for raw in value.split(";")
        if (pair := raw.strip()) and not _is_auth_cookie(pair.split("=", 1)[0].strip())
    ]
    return "; ".join(kept) if kept else None


def _scrub_headers(headers: object) -> None:
    """Strip the ``Authorization`` header and sanitize a raw ``Cookie`` header.

    Handles the usual dict form and, defensively, a list of ``[name, value]``
    pairs. Header names are matched case-insensitively.
    """
    if isinstance(headers, dict):
        for key in list(headers.keys()):
            if not isinstance(key, str):
                continue
            lowered = key.lower()
            if lowered == "authorization":
                del headers[key]
            elif lowered == "cookie":
                sanitized = _sanitize_cookie_header(str(headers[key]))
                if sanitized is None:
                    del headers[key]
                else:
                    headers[key] = sanitized
    elif isinstance(headers, list):
        rebuilt: list[object] = []
        for pair in headers:
            if (
                isinstance(pair, list | tuple)
                and len(pair) == 2
                and isinstance(pair[0], str)
            ):
                lowered = pair[0].lower()
                if lowered == "authorization":
                    continue
                if lowered == "cookie":
                    sanitized = _sanitize_cookie_header(str(pair[1]))
                    if sanitized is None:
                        continue
                    rebuilt.append([pair[0], sanitized])
                    continue
            rebuilt.append(pair)
        headers[:] = rebuilt


def _scrub_cookies(request: dict[str, object]) -> None:
    """Drop ``sb-app-auth*`` entries from the parsed cookies map.

    Defensively also handles ``cookies`` arriving as a raw header string.
    """
    cookies = request.get("cookies")
    if isinstance(cookies, dict):
        for key in list(cookies.keys()):
            if isinstance(key, str) and _is_auth_cookie(key):
                del cookies[key]
    elif isinstance(cookies, str):
        sanitized = _sanitize_cookie_header(cookies)
        if sanitized is None:
            request.pop("cookies", None)
        else:
            request["cookies"] = sanitized


def scrub_event(event: "Event", _hint: "Hint") -> "Event":
    """Sentry ``before_send`` hook: strip auth secrets in place.

    Removes the ``Authorization`` request header and the Supabase auth cookie
    (plus its chunk variants) from both the parsed cookies map and any raw
    ``Cookie`` header. Null-safe: missing ``request``/``headers``/``cookies``
    are no-ops.
    """
    request = event.get("request")
    if isinstance(request, dict):
        _scrub_headers(request.get("headers"))
        _scrub_cookies(request)
    return event
