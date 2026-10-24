"""Focus over HTTP and the sync engine (ADR-0025): a session pushed as rows
the way the phone writes it, the totals the server derives from it, the
day timeline, time on an item, the timer actions, and the stats
contributor over the same rows. Expected totals are worked out by hand from
the timestamps written here."""

import uuid
from collections.abc import Generator
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.focus.stats import contributor
from app.modules.iam.users.models import User
from app.modules.stats.contract import DayProgress, StatsContributor, Window
from tests.utils.mobile import ctx_for, signed_in

API = f"{settings.API_V1_STR}/focus"
SYNC = f"{settings.API_V1_STR}/sync"
MNL = timezone(timedelta(hours=8))
DAY = date(2026, 10, 20)
T0 = datetime(2026, 10, 20, 9, 0, tzinfo=MNL)
M = timedelta(minutes=1)


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def op(kind: str, name: str, row_id: Any, /, **data: Any) -> dict[str, Any]:
    return {"op_id": str(uuid.uuid4()), "kind": kind, "name": name, "id": str(row_id),
            "data": {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in data.items()}}  # fmt: skip


def push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> list[Any]:
    return list(
        ok(client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)}))["results"]
    )


def pull(client: TestClient, h: dict[str, str]) -> list[Any]:
    out: list[Any] = []
    cursor = 0
    while True:
        page = ok(
            client.get(
                f"{SYNC}/pull", headers=h, params={"cursor": cursor, "limit": 500}
            )
        )
        out.extend(page["changes"])
        cursor = page["cursor"]
        if not page["truncated"]:
            return out


class World:
    def __init__(self, user: User, h: dict[str, str]) -> None:
        self.user, self.h = user, h
        self.task, self.habit, self.session = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def seed(client: TestClient, w: World) -> list[Any]:
    """One Pomodoro morning on DAY, as the phone writes it:

    09:00-09:25 focus set 0 on the task, 09:25-09:30 break,
    09:30-09:40 focus set 1 on the task, 09:40-09:45 pause,
    09:45-10:00 focus set 1 on the habit (switched while paused). Ended 10:00.
    Focus 25 + 10 + 15 = 50 min; the task 35, the habit 15; 2 sets.
    """
    task = {"item_kind": "task", "item_id": str(w.task), "item_title": "Write the ADR"}
    habit = {"item_kind": "habit", "item_id": str(w.habit), "item_title": "Read"}
    sid = str(w.session)

    def seg(
        kind: str, a: int, b: int, k: int, planned: int, item: dict[str, Any]
    ) -> Any:
        return op("upsert", "focus_segment", uuid.uuid4(), session_id=sid, kind=kind,
                  started_at=T0 + a * M, ended_at=T0 + b * M, set_index=k,
                  planned_sec=planned, **item)  # fmt: skip

    return push(
        client,
        w.h,
        op("upsert", "task", w.task, title="Write the ADR", estimate_min=60),
        op("upsert", "habit", w.habit, name="Read"),
        op(
            "upsert",
            "focus_session",
            w.session,
            mode="pomodoro",
            preset="25-5",
            focus_min=25,
            short_break_min=5,
            long_break_min=15,
            sets_before_long=4,
            auto_start_breaks=True,
            auto_start_focus=False,
            started_at=T0,
            **task,
        ),  # fmt: skip
        seg("focus", 0, 25, 0, 1500, task),
        seg("break", 25, 30, 0, 300, {}),
        seg("focus", 30, 40, 1, 1500, task),
        seg("pause", 40, 45, 1, 1500, habit),
        seg("focus", 45, 60, 1, 1500, habit),
        op(
            "upsert",
            "focus_session",
            w.session,
            ended_at=T0 + 60 * M,
            end_reason="completed",
            **habit,
        ),  # fmt: skip
        op("upsert", "focus_settings", uuid.uuid4(), daily_goal_min=30),
    )


@pytest.fixture(scope="module")
def world(client: TestClient, db: Session) -> Generator[World, None, None]:
    user, h = signed_in(db)
    w = World(user, h)
    res = seed(client, w)
    assert [r["status"] for r in res] == ["applied"] * len(res), [
        (r["code"], r["message"]) for r in res
    ]
    yield w


# ---------------------------------------------------------------- sync


def test_the_server_derives_the_session_totals(
    client: TestClient, world: World
) -> None:
    rows = {c["id"]: c for c in pull(client, world.h)}
    s = rows[str(world.session)]
    assert s["entity"] == "focus_session"
    assert s["row"]["focus_sec"] == 50 * 60
    assert s["row"]["sets_completed"] == 2
    assert s["row"]["day"] == DAY.isoformat()
    segs = [c for c in rows.values() if c["entity"] == "focus_segment"]
    assert sorted(x["row"]["kind"] for x in segs) == [
        "break",
        "focus",
        "focus",
        "focus",
        "pause",
    ]


def test_settings_land_on_the_one_row_per_user(
    client: TestClient, world: World
) -> None:
    assert ok(client.get(f"{API}/settings", headers=world.h))["daily_goal_min"] == 30
    rows = [c for c in pull(client, world.h) if c["entity"] == "focus_settings"]
    assert len(rows) == 1


def test_bad_rows_are_refused(client: TestClient, world: World) -> None:
    sid = str(world.session)
    res = push(
        client,
        world.h,
        op(
            "upsert",
            "focus_segment",
            uuid.uuid4(),
            session_id=sid,
            kind="focus",
            started_at=T0 + 10 * M,
            ended_at=T0,
        ),  # fmt: skip
        op(
            "upsert",
            "focus_segment",
            uuid.uuid4(),
            session_id=str(uuid.uuid4()),
            kind="focus",
            started_at=T0,
        ),  # fmt: skip
        op(
            "upsert",
            "focus_segment",
            uuid.uuid4(),
            session_id=sid,
            kind="focus",
            started_at=T0,
            item_kind="task",
        ),  # fmt: skip
        op("upsert", "focus_segment", uuid.uuid4(), kind="focus", started_at=T0),
    )
    assert [r["status"] for r in res] == ["rejected"] * 4, res
    assert res[0]["code"] == "focus_range_invalid"
    assert res[2]["code"] == "focus_item_invalid"


def test_another_user_cannot_add_to_the_session(
    client: TestClient, db: Session, world: World
) -> None:
    _, other = signed_in(db)
    res = push(client, other, op("upsert", "focus_segment", uuid.uuid4(),
                                 session_id=str(world.session), kind="focus", started_at=T0))  # fmt: skip
    assert res[0]["status"] == "rejected"


# ---------------------------------------------------------------- reads


def test_the_day_timeline_shows_the_pause(client: TestClient, world: World) -> None:
    day = ok(client.get(f"{API}/day", headers=world.h, params={"day": DAY.isoformat()}))
    assert day["focus_sec"] == 50 * 60 and day["goal_min"] == 30
    kinds = [
        (b["kind"], b["item"]["title"] if b["item"] else None) for b in day["blocks"]
    ]
    assert kinds == [
        ("focus", "Write the ADR"), ("break", None), ("focus", "Write the ADR"),
        ("pause", "Read"), ("focus", "Read"),
    ]  # fmt: skip
    pause = day["blocks"][3]
    assert datetime.fromisoformat(pause["start"]) == T0 + 40 * M
    assert datetime.fromisoformat(pause["end"]) == T0 + 45 * M


def test_the_range_counts_per_day_and_per_item(
    client: TestClient, world: World
) -> None:
    r = ok(client.get(f"{API}/range", headers=world.h,
                      params={"first": "2026-10-19", "last": "2026-10-21"}))  # fmt: skip
    assert [(d["day"], d["focus_sec"], d["on_goal"]) for d in r["days"]] == [
        ("2026-10-19", 0, False), ("2026-10-20", 3000, True), ("2026-10-21", 0, False),
    ]  # fmt: skip
    assert [(i["item"]["title"], i["focus_sec"]) for i in r["items"]] == [
        ("Write the ADR", 2100),
        ("Read", 900),
    ]


def test_time_on_a_task_against_its_estimate(client: TestClient, world: World) -> None:
    t = ok(client.get(f"{API}/items/task/{world.task}", headers=world.h))
    assert t["focus_sec"] == 2100 and t["estimate_min"] == 60
    assert [x["focus_sec"] for x in t["recent"]] == [2100]
    h = ok(client.get(f"{API}/items/habit/{world.habit}", headers=world.h))
    assert h["focus_sec"] == 900 and h["estimate_min"] is None


def test_an_unknown_item_is_not_found(client: TestClient, world: World) -> None:
    r = client.get(f"{API}/items/task/{uuid.uuid4()}", headers=world.h)
    assert r.status_code == 404


def test_sessions_list_by_day(client: TestClient, world: World) -> None:
    body = ok(
        client.get(f"{API}/sessions", headers=world.h, params={"day": DAY.isoformat()})
    )
    assert body["count"] == 1 and body["data"][0]["focus_sec"] == 3000


# ---------------------------------------------------------------- timer actions


def test_the_timer_over_http(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    tid = uuid.uuid4()
    hid = uuid.uuid4()
    push(
        client,
        h,
        op("upsert", "task", tid, title="Inbox zero"),
        op("upsert", "habit", hid, name="Stretch"),
    )
    s = ok(client.post(f"{API}/sessions", headers=h,
                       json={"preset": "50-10", "item": {"kind": "task", "id": str(tid)}}))  # fmt: skip
    assert (s["mode"], s["preset"], s["focus_min"], s["sets_before_long"]) == (
        "pomodoro",
        "50-10",
        50,
        3,
    )
    assert s["phase"]["status"] == "running" and s["phase"]["planned_sec"] == 3000
    assert s["phase"]["item"]["title"] == "Inbox zero"
    assert (
        ok(client.post(f"{API}/current/pause", headers=h))["phase"]["status"]
        == "paused"
    )
    assert (
        ok(client.post(f"{API}/current/resume", headers=h))["phase"]["status"]
        == "running"
    )
    sw = ok(client.post(f"{API}/current/switch", headers=h,
                        json={"item": {"kind": "habit", "id": str(hid)}}))  # fmt: skip
    assert sw["item_kind"] == "habit" and sw["phase"]["item"]["title"] == "Stretch"
    ext = ok(client.post(f"{API}/current/extend", headers=h, json={"sec": 300}))
    assert ext["phase"]["planned_sec"] == 3300
    assert [x["kind"] for x in ext["segments"]] == ["focus", "pause", "focus", "focus"][
        : len(ext["segments"])
    ]
    # Starting again ends the running one first.
    again = ok(client.post(f"{API}/sessions", headers=h, json={"mode": "stopwatch"}))
    assert again["phase"]["remaining_sec"] is None and again["preset"] is None
    first = ok(client.get(f"{API}/sessions/{s['id']}", headers=h))
    assert (
        first["ended_at"] is not None and first["end_reason"] == "abandoned"
    )  # seconds, not minutes
    end = ok(client.post(f"{API}/current/stop", headers=h, json={"abandon": True}))
    assert end["phase"]["status"] == "ended"
    assert ok(client.get(f"{API}/current", headers=h)) is None
    assert client.post(f"{API}/current/pause", headers=h).status_code == 404
    today = ok(client.get(f"{API}/today", headers=h))
    assert (
        today["sessions"] == 0 and today["focus_sec"] == 0 and today["current"] is None
    )


def test_starting_on_someone_elses_task_is_not_found(
    client: TestClient, db: Session, world: World
) -> None:
    _, h = signed_in(db)
    r = client.post(
        f"{API}/sessions",
        headers=h,
        json={"item": {"kind": "task", "id": str(world.task)}},
    )
    assert r.status_code == 404


# ---------------------------------------------------------------- stats


NOW = datetime(2026, 10, 21, 12, 0, tzinfo=MNL)
TODAY = date(2026, 10, 21)


def test_it_is_a_registered_stats_contributor() -> None:
    from app.modules.stats.contract import contributors

    typed: StatsContributor = contributor  # mypy checks the protocol
    assert contributors()["focus"] is typed


def test_area_rate_is_the_mean_share_of_the_goal(world: World) -> None:
    # Due from the first session (DAY): DAY 50m >= 30m -> 1; today 0 -> 0.
    with ctx_for(world.user, now=NOW) as ctx:
        assert (
            contributor.area_rate(ctx, Window(TODAY - timedelta(days=6), TODAY)) == 0.5
        )
        assert (
            contributor.area_rate(ctx, Window(date(2026, 10, 1), date(2026, 10, 7)))
            is None
        )
        prog = contributor.day_progress(ctx, [DAY - timedelta(days=1), DAY, TODAY])
        assert prog == {
            DAY - timedelta(days=1): DayProgress(0, 0),
            DAY: DayProgress(1, 1),
            TODAY: DayProgress(1, 0),
        }


def test_metrics_calendar_and_misses(world: World) -> None:
    with ctx_for(world.user, now=NOW) as ctx:
        w = Window(TODAY - timedelta(days=6), TODAY)
        prev = Window(w.first - timedelta(days=7), w.first - timedelta(days=1))
        m = {x.key: x for x in contributor.metrics(ctx, w, prev)}
        assert m["focused"].value == "50m" and m["focused"].delta == 50
        assert m["daily"].value == "25m"  # 50 min over the two due days
        assert (m["goalDays"].value, m["sessions"].value, m["pomodoros"].value) == (
            "1",
            "1",
            "2",
        )
        cal = contributor.calendar(ctx, w)
        assert [(c.day, c.time, c.title) for c in cal] == [
            (DAY, "09:00", "Focus 50m · Write the ADR")
        ]
        assert contributor.misses(ctx, w) == []
        later = Window(TODAY, TODAY + timedelta(days=1))
    with ctx_for(world.user, now=NOW + timedelta(days=2)) as ctx:
        misses = contributor.misses(ctx, later)
        assert [(x.day, x.title) for x in misses] == [
            (TODAY + timedelta(days=1), "Focused 0m of 30m"), (TODAY, "Focused 0m of 30m"),
        ]  # fmt: skip


def test_achievements_and_the_life_score(world: World) -> None:
    from app.modules.stats import services as stats

    with ctx_for(world.user, now=NOW) as ctx:
        a = {x.id: x for x in contributor.achievements(ctx)}
        assert a["focus-first"].earned and a["focus-first"].day == DAY
        assert a["focus-streak-3"].progress_text == "1/3"
        o = stats.overview(ctx, days=7)
        assert o.life.rates["focus"] == 0.5
        facet = next(f for f in o.facets if f.key == "focus")
        assert facet.value == 0.5 and facet.href == "/focus/stats"
