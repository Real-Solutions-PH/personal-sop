"""Every response carries the baseline security headers."""

from fastapi.testclient import TestClient

from app.core.config import settings


def test_security_headers_present_on_health_check(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/utils/health-check/")
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "permissions-policy" in r.headers


def test_security_headers_present_on_404(client: TestClient) -> None:
    # The middleware wraps every response, including error responses.
    r = client.get("/does-not-exist")
    assert r.status_code == 404
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_no_hsts_in_local(client: TestClient) -> None:
    # HSTS only makes sense over HTTPS; local is plain HTTP.
    assert settings.ENVIRONMENT == "local"
    r = client.get(f"{settings.API_V1_STR}/utils/health-check/")
    assert "strict-transport-security" not in {k.lower() for k in r.headers}
