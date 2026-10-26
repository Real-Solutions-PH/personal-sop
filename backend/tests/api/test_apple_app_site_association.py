from fastapi.testclient import TestClient

from app.main import app


def test_aasa_lists_the_ios_app_for_webcredentials() -> None:
    # Apple fetches this unauthenticated and rejects redirects or non-JSON.
    response = TestClient(app).get(
        "/.well-known/apple-app-site-association", follow_redirects=False
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {
        "webcredentials": {"apps": ["N2Y99Q8A79.com.schadenkai.personal-sop"]}
    }
