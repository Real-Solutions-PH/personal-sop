import uuid

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_http_exception_returns_error_envelope(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
        headers=superuser_token_headers,
    )
    assert response.status_code == 404
    content = response.json()
    assert content == {
        "code": "not_found",
        "message": "User not found",
        "details": None,
    }


def test_unauthenticated_envelope_preserves_www_authenticate(
    client: TestClient,
) -> None:
    response = client.get(f"{settings.API_V1_STR}/users/me")
    assert response.status_code == 401
    assert "WWW-Authenticate" in response.headers
    content = response.json()
    assert content["code"] == "unauthorized"
    assert content["message"] == "Not authenticated"
    assert content["details"] is None


def test_validation_error_returns_envelope_with_details(
    client: TestClient,
) -> None:
    # /private/users is auth-free in ENVIRONMENT=local, so an incomplete
    # body exercises pure request validation.
    response = client.post(
        f"{settings.API_V1_STR}/private/users/",
        json={"email": "someone@example.com"},
    )
    assert response.status_code == 422
    content = response.json()
    assert content["code"] == "validation_error"
    assert content["message"] == "Validation failed"
    assert isinstance(content["details"], list)
    assert len(content["details"]) > 0
    for item in content["details"]:
        assert "loc" in item
        assert "msg" in item
        assert "type" in item


def test_validation_error_never_reflects_submitted_values(
    client: TestClient,
) -> None:
    # pydantic's errors() carries the submitted value under "input" — a
    # POST missing a field must not echo the posted password back.
    secret = "SuperSecretPW123"
    response = client.post(
        f"{settings.API_V1_STR}/private/users/",
        json={"password": secret},
    )
    assert response.status_code == 422
    assert secret not in response.text
    for item in response.json()["details"]:
        assert set(item) == {"loc", "msg", "type"}


def test_unhandled_exception_returns_internal_error_envelope_with_cors() -> None:
    route_path = "/boom-t29"

    @app.get(route_path, include_in_schema=False, tags=["t29"])
    def boom() -> None:  # pragma: no cover - always raises
        raise RuntimeError("super secret internals")

    origin = settings.all_cors_origins[0]
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get(route_path, headers={"Origin": origin})
    finally:
        app.router.routes[:] = [
            r for r in app.router.routes if getattr(r, "path", None) != route_path
        ]

    assert response.status_code == 500
    content = response.json()
    assert content["code"] == "internal_error"
    assert content["message"] == "Internal server error"
    assert "super secret internals" not in content["message"]
    # Exception internals never leave the server in any environment.
    assert content["details"] is None
    assert "super secret internals" not in response.text
    assert response.headers.get("Access-Control-Allow-Origin") == origin
    assert response.headers.get("Access-Control-Allow-Credentials") == "true"
    assert "Origin" in response.headers.get("Vary", "")
