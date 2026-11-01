"""Run and walk sessions recorded on the phone: a finished session syncs as
the ``run_session`` entity; the route and splits are validated; the chat
agent reads recent sessions without the route."""

import uuid
from datetime import timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.modules.fitness import public
from app.modules.stats.public import DIRTY_KEY
from app.modules.sync.registry import registry
from app.shared.owned import utcnow
from tests.modules.tasks.api.helpers import op, pull, push
from tests.utils.mobile import ctx_for, signed_in

START = utcnow().replace(microsecond=0) - timedelta(days=1)


def _session(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "kind": "run",
        "name": "Morning run",
        "started_at": START.isoformat(),
        "ended_at": (START + timedelta(minutes=32)).isoformat(),
        "moving_sec": 1800,
        "distance_m": 5012.4,
        "elevation_gain_m": 41.5,
        "steps": 5100,
        "avg_hr": 152,
        "max_hr": 178,
        "kcal": 402.0,
        "route": [[14.5547, 121.0244, 12.0, 0], [14.5551, 121.0249, None, 4.5]],
        "splits": [{"km": 1, "sec": 355.2, "elev_m": 3.0}, {"km": 2, "sec": 349}],
        "notes": "Felt good",
    }
    base.update(over)
    return base


def test_a_finished_session_pushes_and_pulls(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    rid = uuid.uuid4()
    res = push(client, h, op("upsert", "run_session", rid, **_session()))[0]
    assert res["status"] == "applied", res
    row = res["row"]
    assert (row["kind"], row["distance_m"], row["moving_sec"]) == ("run", 5012.4, 1800)
    assert row["route"][1] == [14.5551, 121.0249, None, 4.5]
    assert row["splits"][0] == {"km": 1, "sec": 355.2, "elev_m": 3.0}
    assert row["splits"][1]["elev_m"] is None
    pulled = {c["id"]: c for c in pull(client, h) if c["entity"] == "run_session"}
    assert pulled[str(rid)]["row"]["name"] == "Morning run"
    # Field-level LWW: a rename keeps the rest.
    upd = push(client, h, op("upsert", "run_session", rid, name="Easy 5k"))[0]
    assert (upd["row"]["name"], upd["row"]["steps"]) == ("Easy 5k", 5100)
    # A minimal walk: everything optional is empty.
    walk = push(
        client,
        h,
        op(
            "upsert",
            "run_session",
            uuid.uuid4(),
            kind="walk",
            name="Walk",
            started_at=START.isoformat(),
            ended_at=START.isoformat(),
            moving_sec=0,
            distance_m=0,
        ),
    )[0]
    assert walk["status"] == "applied", walk
    assert (walk["row"]["route"], walk["row"]["splits"]) == ([], [])
    assert walk["row"]["kcal"] is None and walk["row"]["avg_hr"] is None
    # Delete.
    gone = push(client, h, op("delete", "run_session", rid))[0]
    assert gone["status"] == "applied"


def test_guards_refuse_bad_sessions(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    rid = uuid.uuid4()
    assert (
        push(client, h, op("upsert", "run_session", rid, **_session()))[0]["status"]
        == "applied"
    )
    res = push(
        client,
        h,
        # Create without kind / started_at / ended_at.
        op("upsert", "run_session", uuid.uuid4(), name="x", distance_m=1),
        # Ends before it starts, on create and after merging with the row.
        op(
            "upsert",
            "run_session",
            uuid.uuid4(),
            **_session(ended_at=(START - timedelta(seconds=1)).isoformat()),
        ),
        op(
            "upsert",
            "run_session",
            rid,
            ended_at=(START - timedelta(minutes=1)).isoformat(),
        ),
    )
    got = [(r["status"], r["code"]) for r in res]
    assert got == [
        ("rejected", "missing_fields"),
        ("rejected", "end_before_start"),
        ("rejected", "end_before_start"),
    ]


def test_payload_bounds(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    rid = uuid.uuid4()
    assert (
        push(client, h, op("upsert", "run_session", rid, **_session()))[0]["status"]
        == "applied"
    )
    point = [14.5, 121.0, None, 1]
    bad: list[dict[str, Any]] = [
        {"kind": "swim"},
        {"name": "x" * 81},
        {"moving_sec": -1},
        {"distance_m": 1_000_001},
        {"distance_m": -1},
        {"elevation_gain_m": -0.1},
        {"steps": 300_001},
        {"avg_hr": 19},
        {"max_hr": 251},
        {"kcal": 20_001},
        {"notes": "n" * 2001},
        {"route": [[91, 0, None, 0]]},
        {"route": [[-90.5, 0, None, 0]]},
        {"route": [[0, 180.5, None, 0]]},
        {"route": [[0, 0, None]]},
        {"route": [[0, 0, None, 0, 0]]},
        {"route": [[0, 0, "high", 0]]},
        {"route": [[0, 0, None, -1]]},
        {"route": [point] * 5001},
        {"splits": [{"km": 0, "sec": 300}]},
        {"splits": [{"km": 1, "sec": -1}]},
        {"splits": [{"km": 1, "sec": 300, "elev_m": "up"}]},
        {"splits": [{"km": i + 1, "sec": 300} for i in range(1001)]},
    ]
    res = push(client, h, *[op("upsert", "run_session", rid, **b) for b in bad])
    assert [r["status"] for r in res] == ["rejected"] * len(bad), [
        (b, r.get("code")) for b, r in zip(bad, res, strict=True)
    ]
    # The limits themselves are accepted.
    edge = push(
        client,
        h,
        op(
            "upsert",
            "run_session",
            rid,
            route=[[90, -180, 1.5, 0]] * 5000,
            splits=[{"km": i + 1, "sec": 0, "elev_m": None} for i in range(1000)],
            avg_hr=20,
            max_hr=250,
            steps=300_000,
            kcal=20_000,
        ),
    )[0]
    assert edge["status"] == "applied", edge


def test_a_write_marks_its_days_dirty(db: Session) -> None:
    user, _ = signed_in(db)
    entity = registry().entities["run_session"]
    assert entity.upsert is not None
    rid = uuid.uuid4()
    with ctx_for(user) as ctx:
        entity.upsert(ctx, rid, entity.payload.model_validate(_session()))
        ctx.session.commit()
    moved = START - timedelta(days=3)
    with ctx_for(user) as ctx:
        payload = entity.payload.model_validate(
            {"started_at": moved.isoformat(), "ended_at": moved.isoformat()}
        )
        entity.upsert(ctx, rid, payload)
        dirty = {(mod, day) for _, mod, day in ctx.session.info.get(DIRTY_KEY, set())}
        # The day it left and the day it moved to.
        assert dirty >= {
            ("fitness", ctx.clock.day_of(START)),
            ("fitness", ctx.clock.day_of(moved)),
        }
        ctx.session.rollback()


def test_recent_run_sessions_for_the_chat_agent(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    old, new = uuid.uuid4(), uuid.uuid4()
    long_ago = START - timedelta(days=30)
    push(
        client,
        h,
        op(
            "upsert",
            "run_session",
            old,
            **_session(
                started_at=long_ago.isoformat(),
                ended_at=(long_ago + timedelta(minutes=10)).isoformat(),
            ),
        ),
        op("upsert", "run_session", new, **_session(kind="walk", name="Walk")),
    )
    with ctx_for(user) as ctx:
        got = public.recent_run_sessions(ctx, since=START - timedelta(days=7))
    assert len(got) == 1
    s = got[0]
    assert "route" not in s
    assert set(s) == {
        "kind",
        "name",
        "started_at",
        "ended_at",
        "moving_sec",
        "distance_m",
        "elevation_gain_m",
        "steps",
        "avg_hr",
        "max_hr",
        "kcal",
        "splits",
    }
    assert (s["kind"], s["name"], s["distance_m"]) == ("walk", "Walk", 5012.4)
    with ctx_for(user) as ctx:
        both = public.recent_run_sessions(ctx, since=long_ago - timedelta(days=1))
        assert [r["name"] for r in both] == ["Walk", "Morning run"]
        assert len(public.recent_run_sessions(ctx, since=long_ago, limit=1)) == 1
