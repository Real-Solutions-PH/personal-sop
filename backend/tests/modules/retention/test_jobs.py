"""The nightly retention profile, the nudge sender and push-open tracking,
against the database (docs/26-retention-algorithms.md §7, Slice 1)."""

import uuid
from collections.abc import Generator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.modules.dashboard.models import Notification
from app.modules.habits import public as habits
from app.modules.iam.users.models import User
from app.modules.profile import public as profile_public
from app.modules.profile.models import PushDevice
from app.modules.retention import jobs, sender
from app.modules.retention.models import Nudge, RetentionProfile
from app.modules.usage.models import UsageEvent
from app.shared.context import Ctx, make_ctx
from app.shared.day import DayClock
from tests.utils.day import settled_today
from tests.utils.mobile import signed_in

PINNED = "09:00"


@pytest.fixture
def person(db: Session) -> Generator[tuple[User, dict[str, str]], None, None]:
    user, h = signed_in(db)
    yield user, h


def _ctx(session: Session, user: User, now: datetime) -> Ctx:
    return make_ctx(session, session.merge(user), now=now)


def _today_at(hm: str, plus: timedelta = timedelta()) -> datetime:
    # Waits out a day rollover that is under 90 s away (tests/utils/day.py).
    return DayClock().local_time(settled_today(), hm) + plus


def _setup(
    user: User,
    *,
    last_log_days_ago: int | None = 1,
    pinned: str | None = PINNED,
    mode: str = "daily",
    arm: str = "treated",
    device: bool = True,
) -> uuid.UUID:
    """A habit due every day, its last tick ``last_log_days_ago`` days back,
    a pinned nudge time and a fresh retention profile. Returns the habit."""
    now = _today_at("08:00")
    with Session(engine) as s:
        ctx = _ctx(s, user, now)
        p = profile_public.get_profile(ctx)
        p.nudge_time = pinned
        p.nudge_mode = mode
        s.add(p)
        if device:
            s.add(
                PushDevice(
                    owner_id=user.id,
                    tenant_id=user.tenant_id,
                    token=f"ExponentPushToken[{user.id}]",
                    platform="ios",
                )
            )
        habit = habits.create_habit(ctx, name="Read 10 pages")
        hid = habit.id
        if last_log_days_ago is not None:
            day = ctx.today - timedelta(days=last_log_days_ago)
            log = habits.log_habit(ctx, habit_id=hid, day=day)
            s.commit()
            s.execute(
                text("UPDATE habit_log SET created_at = :at WHERE id = :id"),
                {"at": ctx.clock.local_time(day, "20:00"), "id": log.id},
            )
        s.commit()
        rp = jobs.compute(_ctx(s, user, now))
        rp.arm = arm
        s.add(rp)
        s.commit()
    return hid


def _send(user: User, now: datetime) -> Nudge | None:
    with Session(engine) as s:
        row = sender.send_for(_ctx(s, user, now))
        if row is not None:
            s.refresh(row)
            s.expunge(row)
        return row


def _nudges(db: Session, user: User) -> list[Nudge]:
    db.expire_all()
    return list(db.exec(select(Nudge).where(Nudge.owner_id == user.id)).all())


def _notes(db: Session, user: User) -> list[Notification]:
    db.expire_all()
    return list(
        db.exec(
            select(Notification).where(
                Notification.owner_id == user.id,
                col(Notification.dedupe_key).startswith("nudge:"),
            )
        ).all()
    )


# ---------------------------------------------------------------- nightly


def test_nightly_runs_only_in_the_persons_local_0300_hour(
    db: Session, person: tuple[User, dict[str, str]]
) -> None:
    user, _ = person
    with Session(engine) as s:
        p = profile_public.get_profile(_ctx(s, user, datetime.now(timezone.utc)))
        p.timezone = "America/New_York"
        s.add(p)
        s.commit()
    # 03:20 in Manila is 14:20 the day before in New York: not theirs.
    manila_3am = datetime(2026, 11, 12, 19, 20, tzinfo=timezone.utc)
    with Session(engine) as s:
        jobs.run_nightly(s, now=manila_3am)
    db.expire_all()
    assert (
        db.exec(
            select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
        ).first()
        is None
    )
    ny_3am = datetime(2026, 11, 12, 8, 20, tzinfo=timezone.utc)  # 03:20 EST
    with Session(engine) as s:
        assert jobs.run_nightly(s, now=ny_3am) >= 1
    rp = db.exec(
        select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
    ).one()
    assert rp.computed_day is not None
    assert rp.arm in ("holdout", "treated")
    assert set(rp.slot_hist) == {"weekday", "weekend"}
    # The same hour again: already done today.
    first = rp.updated_at
    with Session(engine) as s:
        jobs.run_nightly(s, now=ny_3am + timedelta(minutes=30))
    db.expire_all()
    rp = db.exec(
        select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
    ).one()
    assert rp.updated_at == first


def test_nightly_reads_logs_and_opens_into_stage_and_best_slot(
    person: tuple[User, dict[str, str]],
) -> None:
    user, _ = person
    _setup(user, last_log_days_ago=4, pinned=None)
    clock = DayClock()
    now = _today_at("08:00")
    # Opens at 19:40 on twelve recent days: the usual time is 19:30.
    with Session(engine) as s:
        for k in range(1, 13):
            day = settled_today() - timedelta(days=k)
            s.add(
                UsageEvent(
                    owner_id=user.id,
                    tenant_id=user.tenant_id,
                    kind="app_open",
                    at=clock.local_time(day, "19:40"),
                )
            )
        s.commit()
        rp = jobs.compute(_ctx(s, user, now))
        assert rp.stage in ("new", "lapsing")
        assert rp.last_log_day == settled_today() - timedelta(days=4)
        assert rp.log_days_total == 1
        # Weekday opens pass the cold-start floor; the weekend row is cold
        # and falls back to the evening push time (21:00).
        assert rp.best_slot_weekday == 39
        assert rp.best_slot_weekend == 42


# ---------------------------------------------------------------- sender


def test_sends_one_best_time_nudge_at_the_pinned_time_and_never_twice(
    db: Session, person: tuple[User, dict[str, str]]
) -> None:
    user, _ = person
    hid = _setup(user)
    assert _send(user, _today_at(PINNED, -timedelta(minutes=5))) is None  # not yet
    row = _send(user, _today_at(PINNED, timedelta(minutes=2)))
    assert row is not None and row.kind == "best_time" and row.suppressed is None
    assert row.sent_at is not None and row.notification_id is not None
    notes = _notes(db, user)
    assert len(notes) == 1
    assert notes[0].href == f"/habits/{hid}"
    assert "Read 10 pages" in notes[0].body
    # Later runs, even an overlapping one, decide nothing new.
    assert _send(user, _today_at(PINNED, timedelta(minutes=7))) is None
    assert len(_nudges(db, user)) == 1 and len(_notes(db, user)) == 1


def test_a_run_more_than_an_hour_late_lets_the_day_go(
    db: Session, person: tuple[User, dict[str, str]]
) -> None:
    user, _ = person
    _setup(user)
    assert _send(user, _today_at(PINNED, timedelta(minutes=61))) is None
    assert _nudges(db, user) == []


def test_no_phone_to_push_to_is_held_back_not_sent(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user, device=False)
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "no_push" and row.sent_at is None
    assert _notes(db, user) == []
    held, _ = signed_in(db)
    _setup(held, device=False, arm="holdout")
    row = _send(held, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "no_push"


def test_the_usual_slot_avoids_a_reminder_set_today(db: Session) -> None:
    """The nightly slot is chosen again at send time against today's task
    reminders: a reminder at the usual time moves the nudge."""
    user, _ = signed_in(db)
    _setup(user, pinned=None)  # cold start: evening push 21:00 -> 20:50
    with Session(engine) as s:
        ctx = _ctx(s, user, _today_at("08:00"))
        from app.modules.tasks.models import Task

        s.add(
            Task(
                **ctx.owned(),
                title="Call mum",
                status="open",
                remind_at=_today_at("20:45"),
            )
        )
        s.commit()
    assert _send(user, _today_at("20:52")) is None  # not 20:50 any more
    assert _nudges(db, user) == []


def test_off_sends_nothing(db: Session, person: tuple[User, dict[str, str]]) -> None:
    user, _ = person
    _setup(user, mode="off")
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "opt_out" and row.sent_at is None
    assert _notes(db, user) == []


def test_holdout_records_the_counterfactual_and_sends_nothing(
    db: Session, person: tuple[User, dict[str, str]]
) -> None:
    user, _ = person
    _setup(user, arm="holdout")
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "holdout" and row.arm == "holdout"
    assert row.sent_at is None and _notes(db, user) == []


def test_opened_or_logged_today_is_skipped(
    db: Session, person: tuple[User, dict[str, str]]
) -> None:
    user, _ = person
    _setup(user)
    with Session(engine) as s:
        s.add(
            UsageEvent(
                owner_id=user.id,
                tenant_id=user.tenant_id,
                kind="app_open",
                at=_today_at("08:30"),
            )
        )
        s.commit()
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "active_today"
    assert _notes(db, user) == []

    other, _ = signed_in(db)
    _setup(other, last_log_days_ago=0)
    row = _send(other, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "active_today"


@pytest.mark.parametrize(
    ("days", "kind"),
    [(3, "ladder_3"), (7, "ladder_7"), (14, "ladder_14"), (2, None), (5, None)],
)
def test_ladder_steps_from_the_last_log_day(
    db: Session, days: int, kind: str | None
) -> None:
    user, _ = signed_in(db)
    _setup(user, last_log_days_ago=days)
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    if kind is None:
        assert row is None and _nudges(db, user) == []
        return
    assert row is not None and row.kind == kind and row.suppressed is None
    note = _notes(db, user)[0]
    if kind == "ladder_14":
        assert note.href == "/me/settings"
    else:
        assert note.href.startswith("/habits/")


def test_day_30_note_only_for_people_with_seven_log_days(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user, last_log_days_ago=30)
    assert _send(user, _today_at(PINNED, timedelta(minutes=1))) is None


def test_backoff_and_budget_hold_the_nudge(db: Session) -> None:
    user, _ = signed_in(db)
    _setup(user)
    with Session(engine) as s:
        rp = s.exec(
            select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
        ).one()
        rp.ignore_streak = 2
        rp.next_nudge_after = settled_today() + timedelta(days=1)
        s.add(rp)
        s.commit()
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "backoff"

    busy, _ = signed_in(db)
    _setup(busy)
    with Session(engine) as s:
        for k in range(1, 5):
            day = settled_today() - timedelta(days=k)
            s.add(
                Nudge(
                    owner_id=busy.id,
                    tenant_id=busy.tenant_id,
                    day=day,
                    kind="best_time",
                    scheduled_for=_today_at(PINNED) - timedelta(days=k),
                    sent_at=_today_at(PINNED) - timedelta(days=k),
                    opened_at=_today_at(PINNED) - timedelta(days=k),
                    arm="treated",
                    dedupe_key=sender.dedupe_key(day),
                )
            )
        s.commit()
    row = _send(busy, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.suppressed == "budget"


# ---------------------------------------------------------------- push opens


def test_tapping_a_nudge_records_opened_at_and_clears_ignores(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    _setup(user)
    with Session(engine) as s:
        rp = s.exec(
            select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
        ).one()
        rp.ignore_streak = 1  # backoff already waited out
        s.add(rp)
        s.commit()
    row = _send(user, _today_at(PINNED, timedelta(minutes=1)))
    assert row is not None and row.notification_id is not None
    tapped = (_today_at(PINNED, timedelta(minutes=20))).isoformat()
    events: list[dict[str, Any]] = [
        {"kind": "push_open", "at": tapped, "detail": str(row.notification_id)},
        {"kind": "push_open", "at": tapped, "detail": "habit"},  # a local reminder
    ]
    r = client.post(
        f"{settings.API_V1_STR}/usage/events", headers=h, json={"events": events}
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    n = db.exec(select(Nudge).where(Nudge.id == row.id)).one()
    assert n.opened_at is not None
    rp = db.exec(
        select(RetentionProfile).where(RetentionProfile.owner_id == user.id)
    ).one()
    assert rp.ignore_streak == 0
    kinds = db.exec(
        select(UsageEvent.detail).where(
            UsageEvent.owner_id == user.id, UsageEvent.kind == "push_open"
        )
    ).all()
    assert sorted(k or "" for k in kinds) == sorted([str(row.notification_id), "habit"])


def test_push_open_needs_a_detail(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.post(
        f"{settings.API_V1_STR}/usage/events",
        headers=h,
        json={"events": [{"kind": "push_open", "at": "2026-11-12T09:00:00+08:00"}]},
    )
    assert r.status_code == 422


# ---------------------------------------------------------------- settings


def test_null_nudge_mode_changes_nothing(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    r = client.patch(
        f"{settings.API_V1_STR}/profile", headers=h, json={"nudge_mode": None}
    )
    assert r.status_code == 200 and r.json()["nudge_mode"] == "daily"


def test_settings_change_mode_and_pin_and_the_next_run_honours_it(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    _setup(user, pinned=None)
    base = f"{settings.API_V1_STR}"
    got = client.get(f"{base}/retention/nudge", headers=h).json()
    assert got["mode"] == "daily" and got["pinned"] is None
    assert got["usual"] is not None  # cold start: the evening push time
    r = client.patch(f"{base}/profile", headers=h, json={"nudge_time": "10:30"})
    assert r.status_code == 200, r.text
    assert r.json()["nudge_time"] == "10:30"
    assert client.get(f"{base}/retention/nudge", headers=h).json()["pinned"] == "10:30"
    for bad in ("06:30", "22:00", "9:00"):
        r = client.patch(f"{base}/profile", headers=h, json={"nudge_time": bad})
        assert r.status_code == 422, bad
    r = client.patch(f"{base}/profile", headers=h, json={"nudge_mode": "off"})
    assert r.status_code == 200
    row = _send(user, _today_at("10:30", timedelta(minutes=2)))
    assert row is not None and row.suppressed == "opt_out"
    # "" unpins: back to the usual time.
    r = client.patch(f"{base}/profile", headers=h, json={"nudge_time": ""})
    assert r.json()["nudge_time"] is None


def test_permission_change_is_stamped(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    base = f"{settings.API_V1_STR}/profile"
    r = client.patch(base, headers=h, json={"push_permission": "denied"})
    assert r.json()["push_permission_changed_at"] is not None
