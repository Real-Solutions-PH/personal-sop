"""Screen time through the sync engine (spec 2026-10-29-screen-time-design):
groups and per-day lower bounds pushed as the phone writes them, the
``(group, day)`` natural key that only ever raises a day, the accepted day
range, the group limits, archiving a group a live rule still points at
(Review Focus 5), and the stats contributor over the same rows."""

import uuid
from datetime import date, timedelta
from typing import Any

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.modules.screen import services as screen_services
from app.modules.screen.stats import contributor
from app.modules.stats import logic as L
from app.modules.stats.contract import DayProgress, StatsContributor, Window
from tests.utils.mobile import ctx_for, signed_in

SYNC = f"{settings.API_V1_STR}/sync"
STATS = f"{settings.API_V1_STR}/stats"
HABITS = f"{settings.API_V1_STR}/habits"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def op(kind: str, name: str, row_id: Any, /, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id),
        "data": data,
    }


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


def today(client: TestClient, h: dict[str, str]) -> date:
    return date.fromisoformat(ok(client.get(f"{HABITS}/today", headers=h))["day"])


def applied(res: list[Any]) -> None:
    assert [r["status"] for r in res] == ["applied"] * len(res), [
        (r["code"], r["message"]) for r in res
    ]


def rejected(res: dict[str, Any], code: str) -> None:
    assert (res["status"], res["code"]) == ("rejected", code), res


def group(row_id: Any, name: str, kind: str = "custom", **f: Any) -> dict[str, Any]:
    return op("upsert", "screen_group", row_id, name=name, kind=kind, **f)


def day_op(row_id: Any, group_id: Any, day: date, **f: Any) -> dict[str, Any]:
    return op(
        "upsert",
        "screen_day",
        row_id,
        group_id=str(group_id),
        day=day.isoformat(),
        **f,
    )


def test_the_contributor_satisfies_the_contract() -> None:
    c: StatsContributor = contributor
    assert (c.key, c.label, c.href) == ("screen", "Screen time", "/screen")


# ---------------------------------------------------------------- sync rows


def test_groups_and_days_push_pull_and_only_ever_rise(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    d = today(client, h)
    gall, gsoc, day1 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    applied(
        push(
            client,
            h,
            group(gall, "All apps", "all", budget_min=240, sort_order=0),
            group(gsoc, "Social", budget_min=30, sort_order=1),
            day_op(day1, gsoc, d, used_min=45, closed=True),
        )
    )
    rows = {c["id"]: c for c in pull(client, h)}
    assert rows[str(gall)]["entity"] == "screen_group"
    assert rows[str(gall)]["row"]["kind"] == "all"
    assert rows[str(gsoc)]["row"]["budget_min"] == 30
    assert rows[str(gsoc)]["row"]["archived_at"] is None
    assert rows[str(day1)]["entity"] == "screen_day"
    assert rows[str(day1)]["row"]["used_min"] == 45
    assert rows[str(day1)]["row"]["closed"] is True

    # A second device (its own id) reports a lower bound, still open: the
    # write lands on the same row, which keeps the higher figure and stays
    # closed.
    res = push(client, h, day_op(uuid.uuid4(), gsoc, d, used_min=15, closed=False))
    applied(res)
    assert res[0]["row"]["id"] == str(day1)
    assert (res[0]["row"]["used_min"], res[0]["row"]["closed"]) == (45, True)
    # A higher figure raises it.
    res = push(client, h, day_op(day1, gsoc, d, used_min=60))
    assert res[0]["row"]["used_min"] == 60
    days = [c for c in pull(client, h) if c["entity"] == "screen_day"]
    assert len(days) == 1

    # A default group: budget 60.
    g3 = uuid.uuid4()
    res = push(client, h, group(g3, "Games"))
    applied(res)
    assert res[0]["row"]["budget_min"] == 60


def test_days_outside_the_last_week_are_refused(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    d = today(client, h)
    g = uuid.uuid4()
    applied(push(client, h, group(g, "Social")))
    res = push(
        client,
        h,
        day_op(uuid.uuid4(), g, d - timedelta(days=8), used_min=5, closed=True),
        day_op(uuid.uuid4(), g, d + timedelta(days=1), used_min=5),
        day_op(uuid.uuid4(), g, d - timedelta(days=7), used_min=5, closed=True),
        day_op(uuid.uuid4(), uuid.uuid4(), d, used_min=5),
    )
    rejected(res[0], "screen_day_out_of_range")
    rejected(res[1], "screen_day_out_of_range")
    assert res[2]["status"] == "applied", res[2]
    rejected(res[3], "screen_group_not_found")


def test_group_rules(client: TestClient, db: Session) -> None:
    _, h = signed_in(db)
    res = push(
        client,
        h,
        group(uuid.uuid4(), ""),
        group(uuid.uuid4(), "x" * 41),
        group(uuid.uuid4(), "Social", kind="other"),
        group(uuid.uuid4(), "Social", budget_min=-1),
    )
    for r in res:
        rejected(r, "validation_error")
    applied(push(client, h, group(uuid.uuid4(), "x" * 40)))
    # One live "all" group per person.
    applied(push(client, h, group(uuid.uuid4(), "All apps", "all")))
    rejected(
        push(client, h, group(uuid.uuid4(), "All", "all"))[0], "integrity_conflict"
    )
    # Six live custom groups at most; an archived one frees a place.
    ids = [uuid.uuid4() for _ in range(5)]
    applied(push(client, h, *(group(i, f"G{n}") for n, i in enumerate(ids))))
    rejected(push(client, h, group(uuid.uuid4(), "Seventh"))[0], "screen_group_limit")
    applied(push(client, h, op("upsert", "screen_group", ids[0], archived_at=_ts())))
    applied(push(client, h, group(uuid.uuid4(), "Seventh")))
    # Un-archiving it would make seven.
    rejected(
        push(client, h, op("upsert", "screen_group", ids[0], archived_at=None))[0],
        "screen_group_limit",
    )


def _ts() -> str:
    return "2026-10-29T08:00:00+00:00"


def test_a_group_a_live_rule_points_at_cannot_be_archived(
    client: TestClient, db: Session
) -> None:
    """Review Focus 5: archiving or deleting the group is refused while a
    live habit's rule points at it, naming those habits; once the habit
    changes, both go through."""
    user, h = signed_in(db)
    g, hid, other = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rule = {"rule_kind": "screen_limit", "rule_group_id": str(g), "rule_max_min": 0}
    applied(
        push(
            client,
            h,
            group(g, "Social"),
            op("upsert", "habit", hid, name="No social", **rule),
            op("upsert", "habit", other, name="Little social", **rule),
        )
    )
    res = push(
        client,
        h,
        op("upsert", "screen_group", g, archived_at=_ts()),
        op("delete", "screen_group", g),
    )
    rejected(res[0], "screen_group_in_use")
    rejected(res[1], "screen_group_in_use")

    # Over REST the same refusal is a 409 whose details list the habits.
    with ctx_for(user) as ctx, pytest.raises(HTTPException) as exc:
        screen_services.delete_group(ctx, group_id=g)
    assert exc.value.status_code == 409
    detail: Any = exc.value.detail
    assert detail["code"] == "screen_group_in_use"
    assert sorted(x["name"] for x in detail["details"]) == [
        "Little social",
        "No social",
    ]
    assert {x["id"] for x in detail["details"]} == {str(hid), str(other)}

    # One habit drops its rule, the other is archived: the group can go.
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
            ),
            op("upsert", "habit", other, status="archived", archived_at=_ts()),
        )
    )
    res = push(client, h, op("upsert", "screen_group", g, archived_at=_ts()))
    applied(res)
    assert res[0]["row"]["archived_at"] is not None
    applied(push(client, h, op("delete", "screen_group", g)))


# ---------------------------------------------------------------- stats


def test_overview_has_the_screen_area_and_ignores_it_without_data(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    ov = ok(client.get(f"{STATS}/overview", headers=h, params={"range": "7d"}))
    areas = {a["module"]: a for a in ov["areas"]}
    assert (areas["screen"]["weight"], areas["screen"]["enabled"]) == (2, True)
    assert areas["screen"]["rate"] is None
    assert [f["key"] for f in ov["facets"]][-1] == "screen"
    facet = ov["facets"][-1]
    assert (facet["label"], facet["module"], facet["href"]) == (
        "Screen time",
        "screen",
        "/screen",
    )
    rates = {k: a["rate"] for k, a in areas.items()}
    weights = {k: a["weight"] for k, a in areas.items()}
    enabled = {k: a["enabled"] for k, a in areas.items()}
    assert ov["life_score"] == L.life_score_of(rates, weights, enabled)


def test_screen_data_moves_the_area_and_its_contributor(
    client: TestClient, db: Session
) -> None:
    user, h = signed_in(db)
    d = today(client, h)
    y, y2 = d - timedelta(days=1), d - timedelta(days=2)
    gall, gsoc, ggame, gzero = (uuid.uuid4() for _ in range(4))
    applied(
        push(
            client,
            h,
            group(gall, "All apps", "all", budget_min=120),
            group(gsoc, "Social", budget_min=30),
            group(ggame, "Games", budget_min=60),
            group(gzero, "Gambling", budget_min=0),
            # Yesterday: social 45 of 30 (0.5), games 30 of 60 (1), all 90 of
            # 120 (1) -> 5/6; the zero-budget group is never scored.
            day_op(uuid.uuid4(), gsoc, y, used_min=45, closed=True),
            day_op(uuid.uuid4(), ggame, y, used_min=30, closed=True),
            day_op(uuid.uuid4(), gall, y, used_min=90, closed=True),
            day_op(uuid.uuid4(), gzero, y, used_min=15, closed=True),
            # Two days ago: only social, within budget -> 1.
            day_op(uuid.uuid4(), gsoc, y2, used_min=10, closed=True),
            # Today is still open: not scored.
            day_op(uuid.uuid4(), gsoc, d, used_min=300, closed=False),
        )
    )
    ov = ok(client.get(f"{STATS}/overview", headers=h, params={"range": "7d"}))
    areas = {a["module"]: a for a in ov["areas"]}
    want = (5 / 6 + 1) / 2
    assert areas["screen"]["rate"] == pytest.approx(want)
    assert ov["facets"][-1]["value"] == pytest.approx(want)

    with ctx_for(user) as ctx:
        prog = contributor.day_progress(ctx, [y2, y, d])
        assert prog[y] == DayProgress(due=3, done=2)
        assert prog[y2] == DayProgress(due=1, done=1)
        assert prog[d] == DayProgress(due=0, done=0)
        w = Window(y2, d)
        (m,) = contributor.metrics(ctx, w, Window(y2 - timedelta(days=3), y2))
        assert (m.key, m.label) == ("screen.used", "Screen time (at least)")
        # A closed day on average of the main figure: "All apps" where it
        # has a row, else the busiest custom group. Two days ago 10 (social),
        # yesterday 90 (all apps); today is open and not counted.
        assert m.value == "≥ 50 min"
        assert m.number == 50
        assert m.good_when == "down"
        assert contributor.calendar(ctx, w) == []
        assert contributor.misses(ctx, w) == []
        assert contributor.achievements(ctx) == []
        assert contributor.facets(ctx, w, w) == []
