"""Screen time switched off: screen data is kept but used nowhere. Stats
read as if there were none, Screen time goals come back ``hidden``, a habit
with a screen-time rule is logged by hand like any habit, and the phone's
``source="screen"`` logs are refused with ``screen_off``."""

import uuid
from datetime import date, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.shared.ids import derived_id
from tests.utils.mobile import signed_in

API = settings.API_V1_STR
HABITS = f"{API}/habits"


def ok(r: Any, status: int = 200) -> Any:
    assert r.status_code == status, r.text
    return r.json()


def err(r: Any, status: int, code: str) -> None:
    assert r.status_code == status, r.text
    assert r.json()["code"] == code, r.json()


def op(kind: str, name: str, row_id: Any, /, **data: Any) -> dict[str, Any]:
    return {
        "op_id": str(uuid.uuid4()),
        "kind": kind,
        "name": name,
        "id": str(row_id) if row_id is not None else None,
        "data": data,
    }


def push(client: TestClient, h: dict[str, str], *ops: dict[str, Any]) -> list[Any]:
    body = ok(client.post(f"{API}/sync/push", headers=h, json={"ops": list(ops)}))
    return list(body["results"])


def applied(res: list[Any]) -> None:
    assert [r["status"] for r in res] == ["applied"] * len(res), [
        (r["code"], r["message"]) for r in res
    ]


def screen(client: TestClient, h: dict[str, str], on: bool) -> None:
    ok(client.patch(f"{API}/profile/modules/screen", headers=h, json={"enabled": on}))


def today(client: TestClient, h: dict[str, str]) -> date:
    return date.fromisoformat(ok(client.get(f"{HABITS}/today", headers=h))["day"])


def screen_log(habit_id: uuid.UUID, day: date) -> dict[str, Any]:
    return op(
        "upsert",
        "habit_log",
        derived_id("screen-habit", habit_id, day.isoformat()),
        habit_id=str(habit_id),
        day=day.isoformat(),
        status="done",
        source="screen",
    )


def seed_screen(client: TestClient, h: dict[str, str], d: date) -> uuid.UUID:
    """An All apps group and a Social group with a 30-minute rule habit and
    a week of closed days, half of them over budget."""
    gall, gsoc, hid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    ops = [
        op("upsert", "screen_group", gall, name="All apps", kind="all", budget_min=120),
        op("upsert", "screen_group", gsoc, name="Social", kind="custom", budget_min=30),
        op(
            "upsert",
            "habit",
            hid,
            name="Little social",
            rule_kind="screen_limit",
            rule_group_id=str(gsoc),
            rule_max_min=30,
        ),
    ]
    for back in range(7):
        day = (d - timedelta(days=back)).isoformat()
        for g, used in (
            (gall, 200 if back % 2 else 60),
            (gsoc, 45 if back % 2 else 10),
        ):
            ops.append(
                op(
                    "upsert",
                    "screen_day",
                    uuid.uuid4(),
                    group_id=str(g),
                    day=day,
                    used_min=used,
                    closed=back > 0,
                )
            )
    applied(push(client, h, *ops))
    return hid


def _anon(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Rows without what names the user's own records."""
    return [{k: v for k, v in r.items() if k not in ("id", "href")} for r in rows]


def reads(client: TestClient, h: dict[str, str], d: date) -> dict[str, Any]:
    """Every stats read a person sees over the last week."""
    week = {"from": (d - timedelta(days=6)).isoformat(), "to": d.isoformat()}
    out: dict[str, Any] = {}
    for rng in ("7d", "30d"):
        ov = ok(client.get(f"{API}/stats/overview", headers=h, params={"range": rng}))
        out[rng] = {
            "life_score": ov["life_score"],
            "prev_score": ov["prev_score"],
            "level": ov["level"],
            "on_target": ov["on_target"],
            "days_series": ov["days_series"],
            "logged_days": ov["logged_days"],
            "today": ov["today"],
            "metrics": ov["metrics"],
            "areas": [a for a in ov["areas"] if a["module"] != "screen"],
            "screen_facet_off": next(
                f["off"] for f in ov["facets"] if f["module"] == "screen"
            ),
        }
    out["today"] = ok(client.get(f"{API}/stats/today", headers=h))["ring"]
    out["misses"] = _anon(
        ok(client.get(f"{API}/stats/misses", headers=h, params=week))["data"]
    )
    out["calendar"] = _anon(
        ok(client.get(f"{API}/stats/calendar", headers=h, params=week))["data"]
    )
    life = ok(client.get(f"{API}/stats/metrics/life", headers=h))
    out["life"] = {k: v for k, v in life.items() if k != "goals"}
    return out


def test_stats_with_screen_off_read_as_if_there_were_no_screen_data(
    client: TestClient, db: Session
) -> None:
    _, with_rows = signed_in(db)
    _, without = signed_in(db)
    d = today(client, with_rows)
    hid = seed_screen(client, with_rows, d)
    # The habit the rule drives is the only habit on both accounts, so the
    # baseline has one plain habit in its place.
    applied(
        push(client, without, op("upsert", "habit", uuid.uuid4(), name="Little social"))
    )
    on = reads(client, with_rows, d)
    assert on["7d"]["screen_facet_off"] is False

    screen(client, with_rows, False)
    screen(client, without, False)
    off, base = reads(client, with_rows, d), reads(client, without, d)
    assert off == base
    assert off["7d"]["screen_facet_off"] is True
    assert not any(m["module"] == "screen" for m in off["7d"]["metrics"])

    # Nothing was deleted: turned back on, the screen area reads as before.
    screen(client, with_rows, True)
    assert reads(client, with_rows, d) == on
    assert ok(client.get(f"{HABITS}/{hid}", headers=with_rows))["habit"]["rule_kind"]


def test_screen_goals_come_back_hidden_while_off(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    goals = f"{API}/dashboard/goals"
    scr = ok(
        client.post(
            goals,
            headers=h,
            json={
                "metric": "screen:screen.used",
                "label": "Screen time a day",
                "target": 120,
                "unit": " min",
                "comparator": "lte",
            },
        )
    )
    other = ok(
        client.post(
            goals, headers=h, json={"metric": "life", "label": "Life", "target": 60}
        )
    )
    assert scr["hidden"] is False

    screen(client, h, False)
    listed = {g["id"]: g for g in ok(client.get(goals, headers=h))["data"]}
    assert listed[scr["id"]]["hidden"] is True
    assert listed[other["id"]]["hidden"] is False
    assert ok(client.get(f"{goals}/{scr['id']}", headers=h))["hidden"] is True
    bundle = ok(client.get(f"{API}/dashboard/today", headers=h))
    assert scr["id"] not in str(bundle)

    screen(client, h, True)
    listed = {g["id"]: g for g in ok(client.get(goals, headers=h))["data"]}
    assert listed[scr["id"]]["hidden"] is False
    assert listed[scr["id"]]["status"] == "active"


def test_a_rule_habit_is_a_plain_habit_while_screen_is_off(
    client: TestClient, db: Session
) -> None:
    _, h = signed_in(db)
    d = today(client, h)
    gsoc, hid = uuid.uuid4(), uuid.uuid4()
    applied(
        push(
            client,
            h,
            op("upsert", "screen_group", gsoc, name="Social", kind="custom"),
            op(
                "upsert",
                "habit",
                hid,
                name="Little social",
                rule_kind="screen_limit",
                rule_group_id=str(gsoc),
                rule_max_min=30,
            ),
        )
    )
    yday = d - timedelta(days=1)
    # On: no hand logging, the phone's screen log lands.
    err(client.post(f"{HABITS}/{hid}/check", headers=h, json={}), 409, "habit_auto")
    applied(push(client, h, screen_log(hid, yday)))

    screen(client, h, False)
    ok(client.post(f"{HABITS}/{hid}/check", headers=h, json={}))
    ok(client.delete(f"{HABITS}/{hid}/log", headers=h, params={"day": d.isoformat()}))
    ok(
        client.put(
            f"{HABITS}/day/{d.isoformat()}",
            headers=h,
            json={"entries": [{"habit_id": str(hid), "status": "done"}]},
        )
    )
    # A synced tap log on a rule habit is accepted, and edits the day's log.
    res = push(
        client,
        h,
        op(
            "upsert",
            "habit_log",
            uuid.uuid4(),
            habit_id=str(hid),
            day=d.isoformat(),
            status="skipped",
            source="tap",
        ),
    )
    applied(res)
    assert res[0]["row"]["status"] == "skipped"
    # The phone's screen logs are refused, and the earlier one is kept.
    res = push(client, h, screen_log(hid, d - timedelta(days=2)))
    assert (res[0]["status"], res[0]["code"]) == ("rejected", "screen_off"), res[0]
    logs = ok(client.get(f"{HABITS}/{hid}", headers=h))
    assert yday.isoformat() in str(logs)

    # Back on: hand logging is refused again.
    screen(client, h, True)
    err(client.post(f"{HABITS}/{hid}/check", headers=h, json={}), 409, "habit_auto")
