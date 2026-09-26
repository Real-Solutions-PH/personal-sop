from typing import Any

from app.core.observability import AUTH_COOKIE_NAME, scrub_event


def _event(**request: Any) -> dict[str, Any]:
    return {"message": "boom", "level": "error", "request": request}


def test_strips_authorization_header_and_auth_cookie() -> None:
    event = _event(
        headers={"Authorization": "Bearer secret", "Accept": "application/json"},
        cookies={"sb-app-auth": "jwt", "theme": "dark"},
    )

    result = scrub_event(event, {})

    headers = result["request"]["headers"]
    cookies = result["request"]["cookies"]
    assert "Authorization" not in headers
    assert headers["Accept"] == "application/json"
    assert AUTH_COOKIE_NAME not in cookies
    assert cookies["theme"] == "dark"
    # Non-secret data preserved.
    assert result["message"] == "boom"
    assert result["level"] == "error"


def test_missing_request_headers_cookies_does_not_throw() -> None:
    # No request key at all.
    assert scrub_event({"message": "x"}, {}) == {"message": "x"}
    # Request present but no headers/cookies.
    assert scrub_event({"request": {}}, {}) == {"request": {}}
    # Empty event.
    assert scrub_event({}, {}) == {}


def test_authorization_header_case_insensitive() -> None:
    for name in ("Authorization", "authorization", "AUTHORIZATION"):
        event = _event(headers={name: "Bearer secret", "X-Trace": "1"})
        result = scrub_event(event, {})
        assert name not in result["request"]["headers"]
        assert result["request"]["headers"]["X-Trace"] == "1"


def test_raw_cookie_header_strips_only_auth_pair() -> None:
    event = _event(headers={"Cookie": "a=1; sb-app-auth=jwt; b=2"})
    result = scrub_event(event, {})
    assert result["request"]["headers"]["Cookie"] == "a=1; b=2"


def test_raw_cookie_header_dropped_when_only_auth_pair() -> None:
    event = _event(headers={"Cookie": "sb-app-auth=jwt"})
    result = scrub_event(event, {})
    assert "Cookie" not in result["request"]["headers"]


def test_chunked_auth_cookies_removed_from_parsed_map() -> None:
    event = _event(
        cookies={
            "sb-app-auth.0": "part0",
            "sb-app-auth.1": "part1",
            "sb-app-auth": "base",
            "keep": "yes",
        },
    )
    result = scrub_event(event, {})
    cookies = result["request"]["cookies"]
    assert cookies == {"keep": "yes"}


def test_chunked_auth_cookies_removed_from_raw_cookie_header() -> None:
    event = _event(
        headers={"cookie": "a=1; sb-app-auth.0=x; sb-app-auth.1=y; b=2"},
    )
    result = scrub_event(event, {})
    assert result["request"]["headers"]["cookie"] == "a=1; b=2"


def test_idempotent_rescrub() -> None:
    event = _event(
        headers={"Authorization": "Bearer secret", "Cookie": "sb-app-auth=jwt; a=1"},
        cookies={"sb-app-auth": "jwt", "keep": "1"},
    )
    once = scrub_event(event, {})
    twice = scrub_event(once, {})
    assert twice == once
    assert "Authorization" not in twice["request"]["headers"]
    assert twice["request"]["headers"]["Cookie"] == "a=1"
    assert twice["request"]["cookies"] == {"keep": "1"}


def test_breadcrumbs_and_other_fields_preserved() -> None:
    crumbs = [{"message": "step 1"}, {"message": "step 2"}]
    event: dict[str, Any] = {
        "message": "boom",
        "level": "warning",
        "breadcrumbs": crumbs,
        "request": {
            "headers": {"Authorization": "Bearer secret", "User-Agent": "pytest"},
            "cookies": {"sb-app-auth": "jwt"},
        },
    }
    result = scrub_event(event, {})
    assert result["breadcrumbs"] == crumbs
    assert result["level"] == "warning"
    assert result["request"]["headers"]["User-Agent"] == "pytest"


def test_headers_as_list_of_pairs_defensive() -> None:
    event = _event(
        headers=[
            ["Authorization", "Bearer secret"],
            ["Cookie", "a=1; sb-app-auth=jwt"],
            ["Accept", "application/json"],
        ],
    )
    result = scrub_event(event, {})
    headers = result["request"]["headers"]
    names = [pair[0] for pair in headers]
    assert "Authorization" not in names
    assert ["Cookie", "a=1"] in headers
    assert ["Accept", "application/json"] in headers


def test_scrubs_transaction_shaped_event() -> None:
    # Transaction events (emitted when tracing is on) also carry request data
    # and flow through before_send_transaction. The scrubber only reads
    # event["request"], so the same function handles them identically.
    event: dict[str, Any] = {
        "type": "transaction",
        "transaction": "GET /api/v1/items",
        "spans": [{"op": "db.query"}],
        "request": {
            "headers": {"Authorization": "Bearer secret", "Accept": "application/json"},
            "cookies": {"sb-app-auth": "jwt", "theme": "dark"},
        },
    }
    result = scrub_event(event, {})
    assert "Authorization" not in result["request"]["headers"]
    assert AUTH_COOKIE_NAME not in result["request"]["cookies"]
    assert result["request"]["headers"]["Accept"] == "application/json"
    # Transaction-specific fields are left untouched.
    assert result["type"] == "transaction"
    assert result["transaction"] == "GET /api/v1/items"
    assert result["spans"] == [{"op": "db.query"}]


def test_non_string_cookie_header_does_not_throw() -> None:
    # Sentry may hand us a non-string Cookie value; scrubbing must coerce
    # rather than crash.
    event = _event(headers={"Cookie": 12345})
    result = scrub_event(event, {})
    assert result["request"]["headers"]["Cookie"] == "12345"
