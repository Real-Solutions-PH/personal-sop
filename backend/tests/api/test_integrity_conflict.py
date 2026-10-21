"""A database integrity race is a 409 in the standard envelope, never a 500
and never the constraint text."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from tests.utils.mobile import signed_in

API = settings.API_V1_STR


def test_reused_client_id_is_409_without_internals(
    client: TestClient, db: Session
) -> None:
    _, alice = signed_in(db)
    _, bob = signed_in(db)
    row_id = str(uuid.uuid4())
    body = {
        "id": row_id,
        "name": "Wallet",
        "type": "cash",
        "opening_minor": 0,
        "opening_date": "2026-10-01",
    }
    assert client.post(
        f"{API}/finance/accounts", headers=alice, json=body
    ).status_code in (200, 201)
    r = client.post(f"{API}/finance/accounts", headers=bob, json=body)
    assert r.status_code == 409, r.text
    payload = r.json()
    assert payload["code"] == "integrity_conflict"
    assert "pkey" not in r.text and row_id not in r.text
