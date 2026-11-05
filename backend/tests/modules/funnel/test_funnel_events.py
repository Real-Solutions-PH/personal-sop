"""Onboarding funnel events: public, batched, fixed vocabulary, no identity."""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.modules.funnel.models import FunnelEvent

API = f"{settings.API_V1_STR}/funnel/events"
AT = "2026-11-05T09:00:00+08:00"


def _rows(db: Session, install: uuid.UUID) -> list[FunnelEvent]:
    db.expire_all()
    return list(
        db.exec(select(FunnelEvent).where(FunnelEvent.install_id == install)).all()
    )


def test_a_batch_is_stored_without_credentials(client: TestClient, db: Session) -> None:
    install = uuid.uuid4()
    r = client.post(
        API,
        json={
            "install_id": str(install),
            "events": [
                {"event": "step_view", "step": "modules", "at": AT},
                {
                    "event": "module_toggle",
                    "step": "modules",
                    "module": "journal",
                    "turned_on": True,
                    "at": AT,
                },
                {"event": "step_skip", "step": "setup", "module": "finance", "at": AT},
                {
                    "event": "module_choice",
                    "step": "modules",
                    "module": "fitness",
                    "turned_on": False,
                    "at": AT,
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"accepted": 4}
    rows = sorted(_rows(db, install), key=lambda x: x.event)
    assert [(x.event, x.step, x.module, x.turned_on) for x in rows] == [
        ("module_choice", "modules", "fitness", False),
        ("module_toggle", "modules", "journal", True),
        ("step_skip", "setup", "finance", None),
        ("step_view", "modules", None, None),
    ]


def test_an_invalid_event_refuses_the_whole_batch(
    client: TestClient, db: Session
) -> None:
    install = uuid.uuid4()
    good = {"event": "step_view", "step": "identity", "at": AT}
    for bad in (
        {"event": "page_view", "step": "identity", "at": AT},
        {"event": "step_view", "step": "checkout", "at": AT},
        {"event": "module_toggle", "step": "modules", "module": "tasks", "at": AT},
        {"event": "module_choice", "step": "modules", "turned_on": True, "at": AT},
        {"event": "step_view", "step": "modules", "turned_on": True, "at": AT},
        {"event": "step_view", "step": "modules", "at": "2026-11-05T09:00:00"},
        {"event": "step_view", "step": "modules", "at": AT, "email": "a@b.c"},
    ):
        r = client.post(API, json={"install_id": str(install), "events": [good, bad]})
        assert r.status_code == 422, bad
    assert _rows(db, install) == []


def test_batch_size_is_bounded(client: TestClient) -> None:
    one = {"event": "step_view", "step": "identity", "at": AT}
    install = str(uuid.uuid4())
    assert (
        client.post(API, json={"install_id": install, "events": []}).status_code == 422
    )
    assert (
        client.post(API, json={"install_id": install, "events": [one] * 51}).status_code
        == 422
    )
