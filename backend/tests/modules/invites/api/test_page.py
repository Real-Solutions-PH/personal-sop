"""The page an invite link opens (``/i/{token}``): it hands the token to the
app's URL scheme and names nothing about what the link invites to."""

from fastapi.testclient import TestClient


def test_page_opens_the_app(client: TestClient) -> None:
    token = "AbC_dEf-1234567890abcdefghijklmn"
    r = client.get(f"/i/{token}")
    assert r.status_code == 200
    assert f"personalsop://invite/{token}" in r.text
    assert 'http-equiv="refresh"' in r.text
    assert "Install Unfurl" in r.text
    assert r.headers["cache-control"] == "no-store"
    assert "script-src" not in r.headers["content-security-policy"]


def test_page_refuses_a_malformed_token(client: TestClient) -> None:
    r = client.get("/i/%3Cscript%3E")
    assert r.status_code == 404
    assert "personalsop://" not in r.text
