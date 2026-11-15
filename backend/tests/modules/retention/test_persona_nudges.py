"""Persona-based nudges from Fern, against the database: the nightly job
stores the archetype, the sender picks the topic from the person's state and
persona, sends it as Fern, and never lands on top of another push."""

from dataclasses import dataclass, field
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.modules.dashboard.models import Notification
from app.modules.habits import public as habits
from app.modules.habits.models import Habit
from app.modules.iam.users.models import User
from app.modules.profile import public as profile_public
from app.modules.retention import jobs
from app.modules.retention.models import RetentionProfile
from app.modules.tasks.models import Task
from app.shared import push
from tests.modules.finance.api.helpers import Fin
from tests.modules.retention.test_jobs import (
    PINNED,
    _ctx,
    _notes,
    _nudges,
    _send,
    _setup,
    _today_at,
)
from tests.utils.day import settled_today
from tests.utils.mobile import signed_in


@dataclass
class Pushes:
    sent: list[push.PushMessage] = field(default_factory=list)


@pytest.fixture()
def pushes(monkeypatch: pytest.MonkeyPatch) -> Pushes:
    rec = Pushes()

    def sender(messages: list[push.PushMessage]) -> list[push.PushTicket]:
        rec.sent.extend(messages)
        return [push.PushTicket(token=m.token, ok=True) for m in messages]

    monkeypatch.setattr(settings, "PUSH_ENABLED", True)
    monkeypatch.setattr(push, "push_sender", sender)
    return rec


def _tasks(user: User, n: int, *, due_in: int | None = None) -> None:
    """``n`` tasks made yesterday (task logs), due ``due_in`` days from today."""
    with Session(engine) as s:
        ctx = _ctx(s, user, _today_at("08:00"))
        for i in range(n):
            s.add(
                Task(
                    **ctx.owned(),
                    title=f"Errand {i}",
                    status="open",
                    created_at=_today_at("08:00") - timedelta(days=1),
                    due_date=(
                        settled_today() + timedelta(days=due_in)
                        if due_in is not None
                        else None
                    ),
                )
            )
        s.commit()


def _persona(user: User, archetype: str | None, secondary: str | None = None) -> None:
    with Session(engine) as s:
        rp = s.exec(
            select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
        ).one()
        rp.archetype = archetype
        rp.secondary = secondary
        s.add(rp)
        s.commit()


def _pin(user: User, hm: str) -> None:
    with Session(engine) as s:
        p = profile_public.get_profile(_ctx(s, user, _today_at("08:00")))
        p.nudge_time = hm
        s.add(p)
        s.commit()


# ---------------------------------------------------------------- nightly


def test_nightly_stores_the_persona_from_the_logs(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user)
    _tasks(user, 12)
    with Session(engine) as s:
        rp = jobs.compute(_ctx(s, user, _today_at("08:00")))
        assert rp.archetype == "planner"
        assert rp.secondary is None  # one habit tick of 13 logs
        assert rp.tags == []


def test_a_habit_reminder_moves_the_usual_slot(db: Session) -> None:
    """A reminder the phone fires itself (a habit's timed slot with a
    reminder) also keeps the nudge 45 min away."""
    user, _ = signed_in(db)
    _setup(user, pinned=None)  # cold start: evening push 21:00 -> 20:50
    with Session(engine) as s:
        ctx = _ctx(s, user, _today_at("08:00"))
        h = habits.create_habit(ctx, name="Floss", time="20:45")
        row = s.get(Habit, h.id)
        assert row is not None
        row.reminder = True
        s.add(row)
        s.commit()
    assert _send(user, _today_at("20:52")) is None
    assert _nudges(db, user) == []


# ---------------------------------------------------------------- topics


def test_a_planners_evening_nudge_is_tomorrows_plan(
    db: Session, pushes: Pushes
) -> None:
    user, _ = signed_in(db)
    _setup(user, pinned="19:00")
    _tasks(user, 3)
    _persona(user, "planner")
    row = _send(user, _today_at("19:00", timedelta(minutes=1)))
    assert row is not None and row.suppressed is None
    assert row.topic == "plan_tomorrow"
    note = _notes(db, user)[0]
    assert note.href == "/plan" and note.title == "Fern"
    assert "Tomorrow's still open" in note.body
    # Sent as Fern: the phone's extension adds Fern's picture.
    assert pushes.sent and pushes.sent[0].fern == "Fern"
    assert push.expo_message(pushes.sent[0])["mutableContent"] is True


def test_with_tomorrow_planned_the_evening_goes_to_the_wrap_up(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user, pinned="19:00")
    _tasks(user, 3, due_in=1)
    _persona(user, "planner")
    row = _send(user, _today_at("19:00", timedelta(minutes=1)))
    assert row is not None and row.topic == "wrap_up"
    note = _notes(db, user)[0]
    assert note.href == "/today/wrap-up"
    assert "0 of 1 done today" in note.body  # the habit due today


def test_a_habit_builder_one_tick_from_a_week(db: Session) -> None:
    user, _ = signed_in(db)
    hid = _setup(user)
    with Session(engine) as s:
        ctx = _ctx(s, user, _today_at("08:00"))
        s.execute(
            text("UPDATE habit SET created_at = :at WHERE id = :id"),
            {"at": _today_at("08:00") - timedelta(days=10), "id": hid},
        )
        for k in range(2, 7):  # with yesterday's: six days in a row
            day = settled_today() - timedelta(days=k)
            log = habits.log_habit(ctx, habit_id=hid, day=day)
            s.commit()
            # Made that evening, not now (a log made today is "active today").
            s.execute(
                text("UPDATE habit_log SET created_at = :at WHERE id = :id"),
                {"at": ctx.clock.local_time(day, "20:00"), "id": log.id},
            )
        s.commit()
    _persona(user, "habit-builder")
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.topic == "near_best"
    note = _notes(db, user)[0]
    assert note.body == "One more Read 10 pages makes 7 days in a row. One tap logs it."
    assert note.href == f"/habits/{hid}"


def test_a_bill_due_tomorrow_comes_first_and_hides_its_name(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    _setup(user)
    f = Fin(client, h)
    account = f.account("Wallet")
    tomorrow = (settled_today() + timedelta(days=1)).isoformat()
    bill = f.post(
        "/planned",
        {
            "name": "Rent share",
            "type": "expense",
            "amount_minor": 1_250_000,
            "account_id": account,
            "schedule": {"kind": "once", "date": tomorrow},
            "start": tomorrow,
        },
    )
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.topic == "bill_due"
    note = _notes(db, user)[0]
    assert note.href == f"/finance/planned/{bill['id']}"
    assert note.body == "A bill is due tomorrow. One tap opens it, ready to mark paid."
    assert "Rent" not in note.body and "12,500" not in note.body


def test_finance_switched_off_means_no_bill_nudge(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    _setup(user)
    f = Fin(client, h)
    account = f.account("Wallet")
    today = settled_today().isoformat()
    f.post(
        "/planned",
        {
            "name": "Phone",
            "type": "expense",
            "amount_minor": 99_900,
            "account_id": account,
            "schedule": {"kind": "once", "date": today},
            "start": today,
        },
    )
    r = client.patch(
        f"{settings.API_V1_STR}/profile/modules/finance",
        headers=h,
        json={"enabled": False},
    )
    assert r.status_code == 200, r.text
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.topic == "habit_due"


# ---------------------------------------------------------------- recent push


def _pushed(user: User, minutes_after_pin: int) -> None:
    at = _today_at(PINNED, timedelta(minutes=minutes_after_pin))
    with Session(engine) as s:
        s.add(
            Notification(
                owner_id=user.id,
                tenant_id=user.tenant_id,
                at=at,
                kind="reminder",
                title="Call mum",
                body="",
                href="/tasks",
                read=False,
                pushed_at=at,
            )
        )
        s.commit()


def test_a_push_minutes_ago_makes_the_nudge_wait_for_the_gap(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user)
    _pushed(user, -5)  # a reminder at 08:55
    assert _send(user, _today_at(PINNED, timedelta(minutes=1))) is None
    assert _send(user, _today_at(PINNED, timedelta(minutes=35))) is None
    assert _nudges(db, user) == []
    row = _send(user, _today_at(PINNED, timedelta(minutes=41)))
    assert row is not None and row.suppressed is None and row.sent_at is not None


def test_a_push_late_in_the_window_lets_the_day_go(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user)
    # The scheduler ran late (09:50) and a reminder went out at 09:45: the
    # 45-minute gap runs past 10:00, the latest the nudge may go.
    _pushed(user, 45)
    row = _send(user, _today_at(PINNED, timedelta(minutes=50)))
    assert row is not None and row.suppressed == "recent_push"
    assert row.sent_at is None and _notes(db, user) == []
