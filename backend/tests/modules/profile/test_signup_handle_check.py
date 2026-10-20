"""The sign-up screen's handle check: public, rate-limited per client
address, and it answers with the verdict only."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.shared import rate_limit
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"
CHECK = f"{API}/signup/handle-available"


def _handle() -> str:
    return f"s{uuid.uuid4().hex[:10]}"


def _claim(client: TestClient, db: Session, handle: str, name: str) -> None:
    _, headers = signed_in(db)
    r = client.post(
        f"{API}/complete-signup",
        headers=headers,
        json={"name": name, "handle": handle},
    )
    assert r.status_code == 200, r.text


def test_needs_no_credentials_and_answers_available(client: TestClient) -> None:
    r = client.get(CHECK, params={"handle": _handle()})
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "available"}


def test_a_handle_another_account_holds_is_taken_whatever_its_case(
    client: TestClient, db: Session
) -> None:
    handle = _handle()
    assert client.get(CHECK, params={"handle": handle}).json()["status"] == (
        "available"
    )
    _claim(client, db, handle, "First Holder")
    for asked in (handle, handle.upper(), f"  {handle}  "):
        r = client.get(CHECK, params={"handle": asked})
        assert r.json() == {"status": "taken"}, asked


def test_a_signed_in_caller_gets_no_your_own_handle_exemption(
    client: TestClient, db: Session
) -> None:
    # The authenticated check tells the owner their handle is "available to
    # them"; the public one has no owner, so even the holder's own token sees
    # it taken (the token is ignored, not required).
    _, headers = signed_in(db)
    handle = _handle()
    claimed = client.post(
        f"{API}/complete-signup", headers=headers, json={"name": "Me", "handle": handle}
    )
    assert claimed.status_code == 200, claimed.text
    r = client.get(CHECK, params={"handle": handle}, headers=headers)
    assert r.json() == {"status": "taken"}


def test_reserved_names_are_taken(client: TestClient) -> None:
    for reserved in ("admin", "Admin", "personal.sop"):
        assert client.get(CHECK, params={"handle": reserved}).json() == {
            "status": "taken"
        }


@pytest.mark.parametrize(
    "bad", ["ab", "has space", "way.too.long.for.a.handle", "émile", "kai!"]
)
def test_malformed_handles_are_invalid_and_never_echoed(
    client: TestClient, bad: str
) -> None:
    r = client.get(CHECK, params={"handle": bad})
    assert r.status_code == 200
    assert r.json() == {"status": "invalid"}
    assert bad not in r.text


def test_out_of_range_length_is_a_422_envelope_without_the_input(
    client: TestClient,
) -> None:
    long = "x" * 41
    r = client.get(CHECK, params={"handle": long})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "validation_error"
    assert long not in r.text


def test_the_answer_says_nothing_about_the_holder(
    client: TestClient, db: Session
) -> None:
    holder, headers = signed_in(db)
    handle = _handle()
    client.post(
        f"{API}/complete-signup",
        headers=headers,
        json={"name": "Visible Name", "handle": handle},
    )
    r = client.get(CHECK, params={"handle": handle})
    assert set(r.json()) == {"status"}
    for secret in (str(holder.id), holder.email, "Visible Name", handle):
        assert secret not in r.text


class _Recorder:
    def __init__(self, allow: bool) -> None:
        self.allowed = allow
        self.calls: list[tuple[uuid.UUID, str, int]] = []

    def allow(self, tenant_id: uuid.UUID, key: str, cost: int) -> bool:
        self.calls.append((tenant_id, key, cost))
        return self.allowed


def test_rate_limited_per_client_address(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    deny = _Recorder(allow=False)
    monkeypatch.setattr(rate_limit, "backend", deny)
    r = client.get(CHECK, params={"handle": _handle()})
    assert r.status_code == 429
    body = r.json()
    assert set(body) == {"code", "message", "details"}
    assert body["code"] == "too_many_requests"
    # One spend, against the client-address bucket (TestClient's host is
    # "testclient"), never a tenant bucket.
    expected = uuid.uuid5(rate_limit._CLIENT_NAMESPACE, "testclient")
    assert deny.calls == [(expected, "client:signup-handle", 1)]


def test_two_addresses_get_two_buckets() -> None:
    class _Req:
        def __init__(self, host: str) -> None:
            self.client = type("C", (), {"host": host})()

    a = rate_limit.client_bucket(_Req("203.0.113.7"))  # type: ignore[arg-type]
    b = rate_limit.client_bucket(_Req("203.0.113.8"))  # type: ignore[arg-type]
    assert a != b
    assert a == rate_limit.client_bucket(_Req("203.0.113.7"))  # type: ignore[arg-type]
