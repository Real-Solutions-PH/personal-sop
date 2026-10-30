"""Onboarding's "about you" answers on complete-signup: what the person does
and how they heard about the app, stored once on the profile."""

import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/profile"
FIELDS = ("occupation", "occupation_detail", "referral_source", "referral_detail")


def _handle() -> str:
    return f"u{uuid.uuid4().hex[:10]}"


def _signup(client: TestClient, h: dict[str, str], **about: Any) -> Any:
    return client.post(
        f"{API}/complete-signup",
        headers=h,
        json={"name": "Alice", "handle": _handle(), **about},
    )


def _about(client: TestClient, h: dict[str, str]) -> dict[str, Any]:
    p = client.get(API, headers=h).json()["profile"]
    return {k: p[k] for k in FIELDS}


def test_complete_signup_stores_the_answers_once(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    r = _signup(
        client,
        h,
        occupation="student",
        occupation_detail="  Nursing ",
        referral_source="tiktok",
        referral_detail="",
    )
    assert r.status_code == 200, r.text
    want = {
        "occupation": "student",
        "occupation_detail": "Nursing",
        "referral_source": "tiktok",
        "referral_detail": None,
    }
    assert {k: r.json()[k] for k in FIELDS} == want
    assert _about(client, h) == want

    # A retried sign-up keeps the first answers and fills only the gaps.
    r = _signup(
        client,
        h,
        occupation="employed",
        referral_source="friend",
        referral_detail="Sam",
    )
    assert r.status_code == 200, r.text
    assert _about(client, h) == {**want, "referral_detail": "Sam"}


def test_answers_are_optional(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    assert _signup(client, h).status_code == 200
    assert _about(client, h) == dict.fromkeys(FIELDS)


def test_invalid_answers_are_refused_and_nothing_is_written(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    for bad in (
        {"occupation": "astronaut"},
        {"referral_source": "billboard"},
        {"occupation": "other", "occupation_detail": "x" * 81},
        {"referral_source": "other", "referral_detail": "y" * 81},
    ):
        r = _signup(client, h, **bad)
        assert r.status_code == 422, (bad, r.text)
    p = client.get(API, headers=h).json()["profile"]
    assert p["handle"] is None
    assert {k: p[k] for k in FIELDS} == dict.fromkeys(FIELDS)
    # Exactly 80 characters is accepted.
    r = _signup(client, h, occupation="other", occupation_detail="z" * 80)
    assert r.status_code == 200, r.text
    assert r.json()["occupation_detail"] == "z" * 80
