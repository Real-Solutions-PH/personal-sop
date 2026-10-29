"""Habits that complete themselves from screen time (spec
2026-10-29-screen-time-design, "Auto habits"): the rule's three columns,
every manual entry point refusing such a habit with 409 ``habit_auto``, and
the sync replay rules for ``screen`` logs (Review Focus 4)."""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.habits import public as habits_public
from app.modules.habits import services as habit_services
from app.modules.habits.schema import HabitSyncIn
from app.shared.ids import derived_id
from tests.modules.habits.api.util import API, err, make_habit, ok, today
from tests.utils.mobile import ctx_for, signed_in

SYNC = f"{settings.API_V1_STR}/sync"


def op(kind: str, name: str, row_id: Any, /, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id is not None else None,
        "data": data,
    }


def push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> list[Any]:
    body = ok(client.post(f"{SYNC}/push", headers=h, json={"ops": list(ops)}))
    return list(body["results"])


def applied(res: list[Any]) -> None:
    assert [r["status"] for r in res] == ["applied"] * len(res), [
        (r["code"], r["message"]) for r in res
    ]


def rejected(res: dict[str, Any], code: str) -> None:
    assert (res["status"], res["code"]) == ("rejected", code), res


def rule(group_id: Any, max_min: int = 30) -> dict[str, Any]:
    return {
        "rule_kind": "screen_limit",
        "rule_group_id": str(group_id),
        "rule_max_min": max_min,
    }


def screen_log(habit_id: Any, day: str, **f: Any) -> dict[str, Any]:
    lid = derived_id("screen-habit", uuid.UUID(str(habit_id)), day)
    return op(
        "upsert",
        "habit_log",
        lid,
        habit_id=str(habit_id),
        day=day,
        status="done",
        source="screen",
        **f,
    )


class World:
    def __init__(self, client: TestClient, db: Session) -> None:
        self.user, self.h = signed_in(db)
        self.day = today(client, self.h)
        self.group, self.auto, self.manual = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        applied(
            push(
                client,
                self.h,
                op("upsert", "screen_group", self.group, name="Social", kind="custom"),
                op(
                    "upsert",
                    "habit",
                    self.auto,
                    name="Little social",
                    **rule(self.group),
                ),
                op("upsert", "habit", self.manual, name="Read"),
            )
        )


@pytest.fixture(scope="module")
def world(client: TestClient, db: Session) -> World:
    return World(client, db)


# ---------------------------------------------------------------- the rule


def test_the_rule_round_trips(client: TestClient, world: World) -> None:
    body = ok(client.get(f"{API}/{world.auto}", headers=world.h))["habit"]
    assert (body["rule_kind"], body["rule_group_id"], body["rule_max_min"]) == (
        "screen_limit",
        str(world.group),
        30,
    )
    plain = ok(client.get(f"{API}/{world.manual}", headers=world.h))["habit"]
    assert (plain["rule_kind"], plain["rule_group_id"], plain["rule_max_min"]) == (
        None,
        None,
        None,
    )


def test_a_rule_is_all_three_fields_on_a_check_habit_and_an_owned_live_group(
    client: TestClient, db: Session, world: World
) -> None:
    g = str(world.group)
    res = push(
        client,
        world.h,
        op("upsert", "habit", uuid.uuid4(), name="A", rule_kind="screen_limit"),
        op("upsert", "habit", uuid.uuid4(), name="B", rule_group_id=g, rule_max_min=5),
        op("upsert", "habit", uuid.uuid4(), name="C", **rule(world.group, 1441)),
        op("upsert", "habit", uuid.uuid4(), name="D", **rule(world.group, -1)),
        op("upsert", "habit", uuid.uuid4(), name="E", **rule(uuid.uuid4())),
        op(
            "upsert",
            "habit",
            uuid.uuid4(),
            name="F",
            type="duration",
            target=10,
            **rule(world.group),
        ),  # fmt: skip
        # Dropping one field of an existing rule leaves it incomplete.
        op("upsert", "habit", world.auto, rule_max_min=None),
        # A rule habit cannot become a duration habit.
        op("upsert", "habit", world.auto, type="count", target=3),
        op("upsert", "habit", uuid.uuid4(), name="G", **rule(world.group, 0)),
    )
    rejected(res[0], "habit_rule_incomplete")
    rejected(res[1], "habit_rule_incomplete")
    rejected(res[2], "validation_error")
    rejected(res[3], "validation_error")
    rejected(res[4], "screen_group_not_found")
    rejected(res[5], "habit_rule_type")
    rejected(res[6], "habit_rule_incomplete")
    rejected(res[7], "habit_rule_type")
    assert res[8]["status"] == "applied", res[8]

    # REST: an incomplete rule is a 422, a type change on a rule habit too.
    with ctx_for(world.user) as ctx, pytest.raises(HTTPException) as exc:
        habit_services.upsert_habit_sync(
            ctx, uuid.uuid4(), HabitSyncIn(name="H", rule_kind="screen_limit")
        )
    assert exc.value.status_code == 422
    err(
        client.patch(f"{API}/{world.auto}", headers=world.h, json={"type": "count"}),
        422,
        "habit_rule_type",
    )

    # Another user's group is not found.
    _, h2 = signed_in(db)
    rejected(
        push(
            client,
            h2,
            op("upsert", "habit", uuid.uuid4(), name="X", **rule(world.group)),
        )[0],  # fmt: skip
        "screen_group_not_found",
    )


def test_an_archived_group_cannot_take_a_new_rule(
    client: TestClient, world: World
) -> None:
    g = uuid.uuid4()
    applied(
        push(
            client,
            world.h,
            op("upsert", "screen_group", g, name="Old", kind="custom"),
            op("upsert", "screen_group", g, archived_at="2026-10-29T08:00:00+00:00"),
        )
    )
    rejected(
        push(client, world.h, op("upsert", "habit", uuid.uuid4(), name="N", **rule(g)))[
            0
        ],  # fmt: skip
        "screen_group_not_found",
    )


# ---------------------------------------------------------------- manual refused


def test_every_manual_entry_point_refuses_a_rule_habit(
    client: TestClient, world: World
) -> None:
    hid, h, day = world.auto, world.h, world.day
    err(client.post(f"{API}/{hid}/check", headers=h, json={}), 409, "habit_auto")
    err(client.post(f"{API}/{hid}/log", headers=h, json={"status": "done"}), 409,
        "habit_auto")  # fmt: skip
    err(client.post(f"{API}/{hid}/increment", headers=h, json={}), 409, "habit_auto")
    err(client.post(f"{API}/{hid}/skip", headers=h, json={}), 409, "habit_auto")
    err(client.post(f"{API}/{hid}/timer", headers=h), 409, "habit_auto")
    err(
        client.put(
            f"{API}/day/{day}",
            headers=h,
            json={"entries": [{"habit_id": str(hid), "status": "done"}]},
        ),
        409,
        "habit_auto",
    )
    # A day-editor save that leaves the rule habit alone still goes through.
    ok(
        client.put(
            f"{API}/day/{day}",
            headers=h,
            json={
                "entries": [
                    {"habit_id": str(hid), "status": None},
                    {"habit_id": str(world.manual), "status": "done"},
                ]
            },
        )
    )
    # A "screen" source is not something a person can claim by hand.
    err(
        client.post(
            f"{API}/{world.manual}/check", headers=h, json={"source": "screen"}
        ),
        422,
    )

    # The day closes within the limit: the phone writes the screen log.
    yday = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    res = push(client, h, screen_log(hid, yday))
    applied(res)
    log_id = res[0]["row"]["id"]
    assert log_id == str(derived_id("screen-habit", hid, yday))
    # Undoing it by hand is refused too.
    err(client.delete(f"{API}/logs/{log_id}", headers=h), 409, "habit_auto")
    err(client.delete(f"{API}/{hid}/log", headers=h, params={"day": yday}), 409,
        "habit_auto")  # fmt: skip

    a = {"habit_id": str(hid), "day": day}
    res = push(
        client,
        h,
        op("action", "habits.check", None, **a),
        op("action", "habits.increment", None, **a),
        op("action", "habits.skip", None, **a),
        op("action", "habits.clear", None, **{**a, "day": yday}),
        op("action", "habits.timer.start", None, habit_id=str(hid)),
        op("delete", "habit_log", log_id),
    )
    for r in res:
        rejected(r, "habit_auto")


def test_a_routine_step_on_a_rule_habit_is_refused(
    client: TestClient, world: World
) -> None:
    rid = ok(
        client.post(
            f"{API}/routines",
            headers=world.h,
            json={
                "name": "Evening",
                "steps": [{"habit_id": str(world.auto), "minutes": 5}],
            },  # fmt: skip
        )
    )["id"]
    run = ok(client.post(f"{API}/routines/{rid}/start", headers=world.h))
    run_id = run["run"]["id"]
    err(client.post(f"{API}/runs/{run_id}/done", headers=world.h), 409, "habit_auto")
    err(client.post(f"{API}/runs/{run_id}/skip", headers=world.h), 409, "habit_auto")
    ok(client.post(f"{API}/runs/{run_id}/exit", headers=world.h))


def test_a_workout_never_ticks_a_rule_habit(client: TestClient, db: Session) -> None:
    user, h = signed_in(db)
    g, hid = uuid.uuid4(), uuid.uuid4()
    applied(
        push(
            client,
            h,
            op("upsert", "screen_group", g, name="Games", kind="custom"),
            op(
                "upsert", "habit", hid, name="Few games", link_workout=True, **rule(g)
            ),  # fmt: skip
        )
    )
    with ctx_for(user) as ctx:
        logs = habits_public.auto_check_workout_habits(
            ctx, day=ctx.today, workout_id=uuid.uuid4()
        )
        assert logs == []


# ---------------------------------------------------------------- sync replay


def test_screen_logs_replay_only_onto_rule_habits(
    client: TestClient, world: World
) -> None:
    """Review Focus 4."""
    h = world.h
    day = (date.fromisoformat(world.day) - timedelta(days=2)).isoformat()
    # A screen log for a habit without a rule.
    rejected(
        push(client, h, screen_log(world.manual, day))[0], "screen_source_mismatch"
    )
    # A tap (or unstated) log for a rule habit.
    res = push(
        client,
        h,
        op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(world.auto),
            day=day,
            status="done",
            source="tap",
        ),  # fmt: skip
        op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(world.auto),
            day=day,
            status="done",
        ),  # fmt: skip
    )
    rejected(res[0], "habit_auto")
    rejected(res[1], "habit_auto")

    # The screen log itself, replayed by two devices: one row, the derived id.
    first = push(client, h, screen_log(world.auto, day))
    again = push(client, h, screen_log(world.auto, day))
    applied(first + again)
    assert first[0]["row"]["id"] == again[0]["row"]["id"]
    assert first[0]["row"]["source"] == "screen"
    logs = ok(client.get(f"{API}/{world.auto}/logs", headers=h))["data"]
    assert [x["day"] for x in logs].count(day) == 1


def test_a_screen_log_never_overwrites_a_log_from_before_the_rule(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    g, hid = uuid.uuid4(), uuid.uuid4()
    applied(push(client, h, op("upsert", "screen_group", g, name="S", kind="custom")))
    hab = make_habit(client, h, id=str(hid), name="Little social")
    day = today(client, h)
    tick = ok(client.post(f"{API}/{hab['id']}/check", headers=h, json={}))
    applied(push(client, h, op("upsert", "habit", hid, **rule(g))))
    res = push(client, h, screen_log(hid, day))
    applied(res)
    assert res[0]["row"]["id"] == tick["id"]
    assert res[0]["row"]["source"] == "tap"

    # Removing the rule makes the habit manual again.
    applied(
        push(
            client,
            h,
            op(
                "upsert",
                "habit",
                hid,
                rule_kind=None,
                rule_group_id=None,
                rule_max_min=None,
            ),  # fmt: skip
        )
    )
    ok(client.post(f"{API}/{hid}/skip", headers=h, json={}))
