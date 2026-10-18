"""Reminder and digest selection, quiet hours in the user's clock."""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.modules.tasks import jobs
from app.modules.tasks.logic import ListView, TasksState, TaskView
from app.shared.day import DayClock

MANILA = DayClock()  # UTC+8, day starts 04:00
# 2026-10-18 12:00 Manila
NOON = datetime(2026, 10, 18, 4, 0, tzinfo=UTC)


def manila(h: int, m: int = 0, d: int = 18) -> datetime:
    return datetime(2026, 10, d, h, m, tzinfo=UTC) - timedelta(hours=8)


@pytest.mark.parametrize(
    ("hm", "start", "end", "quiet"),
    [
        ("21:59", "22:00", "07:00", False),
        ("22:00", "22:00", "07:00", True),
        ("03:00", "22:00", "07:00", True),
        ("06:59", "22:00", "07:00", True),
        ("07:00", "22:00", "07:00", False),
        ("13:00", "12:00", "14:00", True),
        ("14:00", "12:00", "14:00", False),
        ("10:00", "08:00", "08:00", False),
    ],
)
def test_quiet_hours_window(hm: str, start: str, end: str, quiet: bool) -> None:
    assert jobs.in_quiet_hours(hm, start, end) is quiet


def test_default_reminder_in_quiet_hours_waits_for_the_end() -> None:
    late = manila(23, 15)
    got = jobs.deliver_at(
        late, explicit=False, quiet_start="22:00", quiet_end="07:00", clock=MANILA
    )
    assert got == manila(7, 0, d=19)
    early = manila(5, 0)
    got = jobs.deliver_at(
        early, explicit=False, quiet_start="22:00", quiet_end="07:00", clock=MANILA
    )
    assert got == manila(7, 0)


def test_explicit_reminder_fires_on_time_even_in_quiet_hours() -> None:
    late = manila(23, 15)
    got = jobs.deliver_at(
        late, explicit=True, quiet_start="22:00", quiet_end="07:00", clock=MANILA
    )
    assert got == late


def _t(id_: str, **kw: object) -> TaskView:
    base: dict[str, object] = {
        "title": id_,
        "list_id": None,
        "status": "open",
        "created_at": NOON - timedelta(days=5),
    }
    base.update(kw)
    return TaskView(id=id_, **base)  # type: ignore[arg-type]


def test_reminders_due_selection() -> None:
    tasks = [
        _t("due", remind_at=NOON - timedelta(minutes=5), due_time="11:55"),
        _t("future", remind_at=NOON + timedelta(minutes=5), due_time="12:05"),
        _t("done", status="done", remind_at=NOON - timedelta(minutes=5)),
        _t("stale", remind_at=NOON - timedelta(hours=25)),
        _t("none"),
    ]
    got = jobs.reminders_due(
        tasks, now=NOON, quiet_start="22:00", quiet_end="07:00", clock=MANILA
    )
    assert [r.task.id for r in got] == ["due"]

    night = manila(23, 30)
    default = _t("default", remind_at=manila(23, 0))  # date-only: deferred
    timed = _t("timed", remind_at=manila(23, 0), due_time="23:00")
    at_night = jobs.reminders_due(
        [default, timed],
        now=night,
        quiet_start="22:00",
        quiet_end="07:00",
        clock=MANILA,
    )
    assert [r.task.id for r in at_night] == ["timed"]
    morning = jobs.reminders_due(
        [default, timed],
        now=manila(7, 1, d=19),
        quiet_start="22:00",
        quiet_end="07:00",
        clock=MANILA,
    )
    # sorted by delivery time: the timed one went out at 23:00
    assert [r.task.id for r in morning] == ["timed", "default"]


def test_dedupe_key_changes_when_snoozed() -> None:
    a = jobs.reminder_dedupe_key("t1", NOON)
    assert a == jobs.reminder_dedupe_key("t1", NOON)
    assert a != jobs.reminder_dedupe_key("t1", NOON + timedelta(hours=1))


def test_fmt_time() -> None:
    assert [jobs.fmt_time(x) for x in ("15:00", "09:30", "00:05", "12:00")] == [
        "3 PM",
        "9:30 AM",
        "12:05 AM",
        "12 PM",
    ]


def _state(*tasks: TaskView) -> TasksState:
    return TasksState(
        lists=[ListView(id="g", name="Groceries", kind="shopping")], tasks=list(tasks)
    )


def test_digest_waits_for_its_time_and_quiet_hours() -> None:
    today = date(2026, 10, 18)
    st = _state(
        _t("a", due_date=today),
        _t("b", due_date=today - timedelta(days=1)),
        _t("eggs", list_id="g", due_date=today),
    )
    kw = {
        "digest_time": "07:30",
        "quiet_start": "22:00",
        "quiet_end": "07:00",
        "clock": MANILA,
    }
    assert jobs.digest_for(st, now=manila(7, 29), **kw) is None  # type: ignore[arg-type]
    d = jobs.digest_for(st, now=manila(7, 30), **kw)  # type: ignore[arg-type]
    assert d is not None
    assert (d.title, d.due, d.overdue) == ("1 task today · 1 overdue", 1, 1)
    # a digest time inside quiet hours goes out when they end
    kw2 = {**kw, "digest_time": "06:00"}
    assert jobs.digest_for(st, now=manila(6, 30), **kw2) is None  # type: ignore[arg-type]
    assert jobs.digest_for(st, now=manila(7, 0), **kw2) is not None  # type: ignore[arg-type]
    assert jobs.digest_for(_state(), now=manila(9, 0), **kw) is None  # type: ignore[arg-type]
