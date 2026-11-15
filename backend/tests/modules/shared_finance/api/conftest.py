"""A lender, a borrower and a stranger in one tenant, each with an account.

``kai`` lends; ``mia`` borrows (Kai follows her, so they are connected);
``sam`` is in the same tenant and connected to nobody. Fresh people per
test, so no loan or follow leaks between tests.
"""

import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.iam.users.models import User
from app.modules.media.models import MediaObject
from tests.modules.finance.api.helpers import Fin
from tests.utils.mobile import signed_in

API = f"{settings.API_V1_STR}/finance/shared"
SOCIAL = f"{settings.API_V1_STR}/social"


@dataclass
class Member:
    id: uuid.UUID
    headers: dict[str, str]
    name: str
    fin: Fin
    account: str
    c: TestClient

    def call(self, method: str, path: str, body: Any = None, status: int = 200) -> Any:
        r = self.c.request(method, f"{API}{path}", headers=self.headers, json=body)
        assert r.status_code == status, r.text
        return r.json() if r.content else None

    def post(self, path: str, body: Any = None, status: int = 200) -> Any:
        return self.call("POST", path, body if body is not None else {}, status)

    def get(self, path: str, status: int = 200) -> Any:
        return self.call("GET", path, None, status)


def _member(client: TestClient, db: Session, name: str) -> Member:
    user, headers = signed_in(db)
    handle = f"{name.lower()[:6]}{secrets.token_hex(6)}"
    r = client.patch(
        f"{settings.API_V1_STR}/profile",
        headers=headers,
        json={"name": name, "handle": handle},
    )
    assert r.status_code == 200, r.text
    fin = Fin(client, headers)
    account = fin.account(f"{name} wallet", opening=5_000_000)
    return Member(
        id=user.id,
        headers=headers,
        name=name,
        fin=fin,
        account=account,
        c=client,
    )


@dataclass
class Trio:
    kai: Member
    mia: Member
    sam: Member


@pytest.fixture()
def trio(client: TestClient, db: Session) -> Trio:
    t = Trio(
        kai=_member(client, db, "Kai"),
        mia=_member(client, db, "Mia"),
        sam=_member(client, db, "Sam"),
    )
    r = client.put(f"{SOCIAL}/people/{t.mia.id}/follow", headers=t.kai.headers)
    assert r.status_code == 200, r.text
    return t


@pytest.fixture()
def photo(db: Session) -> Callable[[Member], str]:
    """A ready image uploaded by ``who`` (no bytes needed to reference it)."""

    def make(who: Member) -> str:
        user = db.get(User, who.id)
        assert user is not None
        m = MediaObject(
            owner_id=who.id,
            tenant_id=user.tenant_id,
            kind="image",
            storage_key=f"u/{who.id}/{uuid.uuid4()}",
            mime="image/jpeg",
            size_bytes=10,
            state="ready",
            width=800,
            height=600,
        )
        db.add(m)
        db.commit()
        return str(m.id)

    return make
