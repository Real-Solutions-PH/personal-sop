"""The Python timer against the prototype's (ADR-0025): every case in
``scripts/golden/focus.golden.test.ts`` replayed here, compared field by
field with what the TypeScript produced (``tests/golden/focus-logic.json``)."""

import json
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from app.modules.focus import logic as L
from app.shared.day import DayClock

DATA: dict[str, Any] = json.loads(
    (Path(__file__).parents[3] / "golden" / "focus-logic.json").read_text()
)["data"]
T0 = datetime.fromtimestamp(DATA["t0"] / 1000, tz=timezone.utc)
SID = uuid.UUID(DATA["sessionId"])


def item(raw: dict[str, Any]) -> L.Item:
    return L.Item(raw["kind"], uuid.UUID(raw["id"]), raw["title"])


TASK, HABIT = item(DATA["task"]), item(DATA["habit"])


def ms(t: datetime | None) -> int | None:
    return None if t is None else round(t.timestamp() * 1000)


def at(m: float) -> datetime:
    return T0 + timedelta(minutes=m)


def replay(c: dict[str, Any]) -> list[dict[str, Any]]:
    n = iter(range(100, 10_000))

    def new_id() -> uuid.UUID:
        return uuid.UUID(f"00000000-0000-4000-8000-{next(n):012d}")

    tl = L.start(
        session_id=SID, segment_id=new_id(), mode=c["mode"], lengths=tuple(c["lengths"]),
        auto_start_breaks=c["autoBreaks"], auto_start_focus=c["autoFocus"], item=TASK,
        now=at(c["startMin"]),
    )  # fmt: skip
    acts, probes = list(c["acts"]), [p["min"] for p in c["probes"]]
    out: list[dict[str, Any]] = []
    clock = DayClock()
    while acts or probes:
        next_act = acts[0][1] if acts else float("inf")
        if probes and probes[0] < next_act:
            m = probes.pop(0)
            now = at(m)
            a = L.advance(tl, now)
            p = L.phase(a, now)
            spans = L.counted([a], now)
            out.append(
                {
                    "min": m,
                    "segs": [
                        {"id": str(s.id), "kind": s.kind, "set": s.set_index,
                         "start": ms(s.started_at), "end": ms(s.ended_at),
                         "planned": s.planned_sec, "item": str(s.item.id) if s.item else None}
                        for s in a.segs
                    ],
                    "ended": ms(a.sess.ended_at),
                    "reason": a.sess.end_reason,
                    "phase": {
                        "status": p.status, "kind": p.kind, "set": p.set_index,
                        "planned": p.planned_sec, "elapsed": p.elapsed, "remaining": p.remaining,
                        "longBreak": p.long_break, "endsAt": ms(p.ends_at),
                        "item": str(p.item.id) if p.item else None,
                    },
                    "focusSec": L.focus_sec(a, now),
                    "sets": L.sets_completed(a, now),
                    "perDay": {
                        d.isoformat(): v
                        for d, v in L.per_day(spans, clock, date(2026, 10, 19), date(2026, 10, 22)).items()
                    },
                    "perItem": {
                        (f"{k[0]}:{k[1]}" if k else ""): v for k, v in L.per_item(spans).items()
                    },
                }
            )  # fmt: skip
            continue
        a = acts.pop(0)
        now = at(a[1])
        verb = a[0]
        if verb == "pause":
            tl = L.pause(tl, now, new_id)
        elif verb == "resume":
            tl = L.resume(tl, now, new_id)
        elif verb == "next":
            tl = L.start_next(tl, now, new_id)
        elif verb == "skip":
            tl = L.skip_break(tl, now, new_id)
        elif verb == "stop":
            tl = L.stop(tl, now)
        elif verb == "abandon":
            tl = L.stop(tl, now, abandon=True)
        elif verb == "tick":
            tl = L.advance(tl, now)
        elif verb == "extend":
            tl = L.extend(tl, now, a[2])
        else:
            pick = {"habit": HABIT, "task": TASK}.get(a[2]) if a[2] else None
            tl = L.switch(tl, now, pick, new_id)
    return out


@pytest.mark.parametrize("case", DATA["cases"], ids=[c["name"] for c in DATA["cases"]])
def test_replays_like_the_prototype(case: dict[str, Any]) -> None:
    got = replay(case)
    assert len(got) == len(case["probes"])
    for g, w in zip(got, case["probes"], strict=True):
        assert g["segs"] == w["segs"], (case["name"], g["min"])
        assert (g["ended"], g["reason"]) == (w["ended"], w["reason"]), g["min"]
        gp, wp = g["phase"], w["phase"]
        for k in ("elapsed", "remaining"):
            assert gp[k] == pytest.approx(wp[k]) if wp[k] is not None else gp[k] is None
        assert {k: v for k, v in gp.items() if k not in ("elapsed", "remaining")} == {
            k: v for k, v in wp.items() if k not in ("elapsed", "remaining")
        }, (case["name"], g["min"])
        assert (g["focusSec"], g["sets"]) == (w["focusSec"], w["sets"]), g["min"]
        assert g["perDay"] == w["perDay"] and g["perItem"] == w["perItem"], g["min"]


def test_every_case_was_replayed() -> None:
    assert len(DATA["cases"]) >= 14
