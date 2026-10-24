"""Three signed-in people in one tenant, plus recorders for the event and
push seams.

``ana`` posts; ``ben`` follows her; ``cy`` is in the same tenant and follows
nobody. Each test gets fresh people (GoTrue users are cheap) so the follow
graph never leaks between tests.
"""

import secrets
import uuid
from collections.abc import Callable, Generator
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.realtime import presence
from app.modules.social import notify, services
from app.shared import events, push
from tests.modules.social.api.helpers import API, ok
from tests.utils.mobile import signed_in


@dataclass
class Person:
    id: uuid.UUID
    headers: dict[str, str]
    name: str
    handle: str


@dataclass
class Bus:
    """Every event published during a test: ``(user_id, type, data)``."""

    sent: list[tuple[uuid.UUID, str, dict[str, Any]]] = field(default_factory=list)

    def of(self, user: Person, type_: str | None = None) -> list[dict[str, Any]]:
        return [
            d for u, t, d in self.sent if u == user.id and (type_ is None or t == type_)
        ]

    def types(self, user: Person) -> list[str]:
        return [t for u, t, _ in self.sent if u == user.id]

    def clear(self) -> None:
        self.sent.clear()


@dataclass
class Pushes:
    sent: list[push.PushMessage] = field(default_factory=list)
    live: set[uuid.UUID] = field(default_factory=set)

    def tokens(self) -> list[str]:
        return [m.token for m in self.sent]


@pytest.fixture()
def bus(monkeypatch: pytest.MonkeyPatch) -> Bus:
    rec = Bus()

    def sink(user_id: uuid.UUID, type_: str, data: dict[str, Any]) -> None:
        rec.sent.append((user_id, type_, data))

    monkeypatch.setattr(events, "sink", sink)
    monkeypatch.setattr(services, "typing_gate", lambda _u, _c: True)
    return rec


@pytest.fixture()
def pushes(monkeypatch: pytest.MonkeyPatch) -> Pushes:
    rec = Pushes()

    def sender(messages: list[push.PushMessage]) -> list[push.PushTicket]:
        rec.sent.extend(messages)
        return [push.PushTicket(token=m.token, ok=True) for m in messages]

    monkeypatch.setattr(settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(push, "push_sender", sender)
    monkeypatch.setattr(notify, "run_push", lambda fn: fn())
    monkeypatch.setattr(presence, "probe", lambda uid: uid in rec.live)
    return rec


def _person(client: TestClient, db: Session, name: str) -> Person:
    user, headers = signed_in(db)
    # 3 random bytes collided with a leftover user in CI ("handle_taken");
    # 6 keep the handle under its 20-character limit.
    handle = f"{name.lower()[:6]}{secrets.token_hex(6)}"
    ok(
        client.patch(
            f"{settings.API_V1_STR}/profile",
            headers=headers,
            json={"name": name, "handle": handle},
        )
    )
    return Person(id=user.id, headers=headers, name=name, handle=handle)


@pytest.fixture()
def people(client: TestClient, db: Session) -> Callable[[str], Person]:
    return lambda name: _person(client, db, name)


@dataclass
class Trio:
    ana: Person
    ben: Person
    cy: Person


@pytest.fixture()
def trio(
    client: TestClient, people: Callable[[str], Person], bus: Bus
) -> Generator[Trio, None, None]:
    t = Trio(ana=people("Ana"), ben=people("Ben"), cy=people("Cy"))
    ok(client.put(f"{API}/people/{t.ana.id}/follow", headers=t.ben.headers))
    bus.clear()
    yield t
