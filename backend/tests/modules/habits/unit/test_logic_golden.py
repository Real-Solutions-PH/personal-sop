"""``app.modules.habits.logic`` against the prototype's own output.

Every expected value comes from ``tests/golden/habits-logic.json``, which
``scripts/golden/habits.golden.test.ts`` writes by running
``shared/prototype/habits/logic.ts`` over the seed at the frozen clock. The
fixture rows are converted to views here with plain field mapping; nothing on
the expected side is computed by the code under test.
"""

import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pytest

from app.modules.habits import logic as L

GOLDEN = Path(__file__).parents[3] / "golden" / "habits-logic.json"
FIX: dict[str, Any] = json.loads(GOLDEN.read_text())["data"]
TODAY = date.fromisoformat(FIX["today"])


def _d(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def _t(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def _slots(raw: list[dict[str, Any]]) -> tuple[L.Slot, ...]:
    return tuple(
        L.Slot(days=tuple(s["days"]), time=s.get("time"), window=s.get("window"))
        for s in raw
    )


def _habit(h: dict[str, Any]) -> L.HabitView:
    return L.HabitView(
        id=h["id"],
        name=h["name"],
        type=h["type"],
        schedule=_slots(h["schedule"]),
        created=date.fromisoformat(h["createdAt"]),
        status=h["status"],
        pauses=tuple(
            L.Pause(from_day=date.fromisoformat(p["from"]), to_day=_d(p.get("to")))
            for p in h["pauses"]
        ),
        archived=_d(h.get("archivedAt")),
        sort_order=h["sortOrder"],
        target=h.get("target"),
    )


def _steps(raw: list[dict[str, Any]]) -> tuple[L.StepView, ...]:
    return tuple(L.StepView(habit_id=s["habitId"], minutes=s["minutes"]) for s in raw)


HABITS = [_habit(h) for h in FIX["state"]["habits"]]
BY_ID = {h.id: h for h in HABITS}
LOGS = [
    L.LogView(
        habit_id=lg["habitId"],
        day=date.fromisoformat(lg["day"]),
        status=lg["status"],
        logged_at=_t(lg["loggedAt"]),  # type: ignore[arg-type]
        value=lg.get("value"),
    )
    for lg in FIX["state"]["logs"]
]
IDX = L.log_index(LOGS)
ROUTINES = [
    L.RoutineView(
        id=r["id"],
        name=r["name"],
        schedule=_slots(r["schedule"]),
        created=date.fromisoformat(r["createdAt"]),
        status=r["status"],
        steps=_steps(r["steps"]),
    )
    for r in FIX["state"]["routines"]
]
RUNS = [
    L.RunView(
        id=x["id"],
        routine_id=x["routineId"],
        day=date.fromisoformat(x["day"]),
        state=x["state"],
        steps=_steps(x["steps"]),
        results=tuple(
            L.ResultView(
                habit_id=r["habitId"], status=r["status"], actual_sec=r["actualSec"]
            )
            for r in x["results"]
        ),
        current=x["current"],
    )
    for x in FIX["state"]["runs"]
]
ACTIVE = [h for h in HABITS if h.status != "archived"]


def test_fixture_reaches_every_cell_kind() -> None:
    kinds = {c for row in FIX["cells"].values() for c in row}
    assert kinds == {
        "done",
        "partial",
        "skipped",
        "missed",
        "paused",
        "pending",
        "bonus",
        "none",
        "future",
    }


@pytest.mark.parametrize("habit_id", sorted(FIX["cells"]))
def test_cell_for(habit_id: str) -> None:
    days = [date.fromisoformat(d) for d in FIX["cellDays"]]
    got = [L.cell_for(BY_ID[habit_id], d, IDX, TODAY) for d in days]
    assert got == FIX["cells"][habit_id]


def test_habit_stats() -> None:
    assert len(FIX["habitStats"]) > 40
    for case in FIX["habitStats"]:
        s = L.habit_stats(
            BY_ID[case["habitId"]],
            IDX,
            date.fromisoformat(case["from"]),
            date.fromisoformat(case["to"]),
            TODAY,
        )
        exp = case["stats"]
        got = {
            "scheduled": s.scheduled,
            "done": s.done,
            "partial": s.partial,
            "skipped": s.skipped,
            "missed": s.missed,
            "bonus": s.bonus,
            "minutes": s.minutes,
            "countTotal": s.count_total,
            "rate": s.rate,
            "skipRate": s.skip_rate,
            "onTime": s.on_time,
        }
        assert got == pytest.approx(exp), case["habitId"] + " " + case["from"]


def test_on_time_is_exercised_both_ways() -> None:
    rates = {c["stats"]["onTime"] for c in FIX["habitStats"]}
    assert any(0 < r < 1 for r in rates)


def test_streaks() -> None:
    for case in FIX["streaks"]:
        s = L.streaks(BY_ID[case["habitId"]], IDX, TODAY)
        assert (s.current, s.best) == (case["current"], case["best"]), case["habitId"]
        assert [(b.day.isoformat(), b.length) for b in s.broken] == [
            (b["day"], b["length"]) for b in case["broken"]
        ]


def test_overall_stats() -> None:
    for case in FIX["overallStats"]:
        s = L.overall_stats(HABITS, IDX, case["days"], TODAY, offset=case["offset"])
        exp = case["stats"]
        assert {
            "rate": s.rate,
            "skipRate": s.skip_rate,
            "minutes": s.minutes,
            "perfect": s.perfect,
            "missed": s.missed,
            "done": s.done,
        } == pytest.approx(exp), case


def test_overall_days() -> None:
    got = L.overall_days(
        ACTIVE,
        IDX,
        date.fromisoformat(FIX["overallDays"][0]["day"]),
        date.fromisoformat(FIX["overallDays"][-1]["day"]),
        TODAY,
    )
    assert [
        {"day": d.day.isoformat(), "due": d.due, "done": d.done, "rate": d.rate}
        for d in got
    ] == FIX["overallDays"]


def test_routine_stats_and_run_state() -> None:
    by_id = {r.id: r for r in ROUTINES}
    for case in FIX["routineStats"]:
        s = L.routine_stats(by_id[case["routineId"]], RUNS, case["days"], TODAY)
        assert s.scheduled_days == case["scheduledDays"]
        assert s.completed == case["completed"]
        assert [x.id for x in s.abandoned] == case["abandoned"]
        assert [x.id for x in s.runs] == case["runs"]
        assert s.rate == pytest.approx(case["rate"])
        assert s.pace == pytest.approx(case["pace"])
    states = {x.id: L.run_state(x, TODAY) for x in RUNS}
    assert states == {c["id"]: c["state"] for c in FIX["runStates"]}
    assert states["run-stale"] == "abandoned"


def test_most_missed_weekday() -> None:
    for case in FIX["mostMissed"]:
        got = L.most_missed_weekday(
            ACTIVE, IDX, date.fromisoformat(case["from"]), TODAY
        )
        exp = case["result"]
        assert (None if got is None else {"day": got.day, "count": got.count}) == exp


def test_today_group() -> None:
    for case in FIX["todayGroups"]:
        h = BY_ID[case["habitId"]]
        log = IDX.get((h.id, TODAY))
        if case["log"] == "partial":
            log = L.LogView(
                habit_id=h.id,
                day=TODAY,
                status="partial",
                logged_at=_t("2026-10-18T03:00:00.000Z"),  # type: ignore[arg-type]
                value=1,
            )
        now = datetime.fromisoformat(case["now"])
        assert L.today_group(h, log, TODAY, now) == case["group"], case


def test_step_elapsed() -> None:
    for case in FIX["elapsedCases"]:
        got = L.step_elapsed(
            _t(case["stepStartedAt"]),  # type: ignore[arg-type]
            _t(case["now"]),  # type: ignore[arg-type]
            paused_at=_t(case.get("pausedAt")),
            step_paused_sec=case["stepPausedSec"],
        )
        assert got == pytest.approx(case["elapsed"])


def test_sorted_habits() -> None:
    got = [h.id for h in L.sorted_habits(list(reversed(HABITS)))]
    assert got == FIX["sorted"]


def test_perfect_days_never_count_today() -> None:
    for case in FIX["perfectToday"]:
        hs = [BY_ID[i] for i in case["habitIds"]]
        assert hs, "fixture needs habits done today"
        s = L.overall_stats(hs, IDX, case["days"], TODAY)
        assert s.perfect == case["stats"]["perfect"]
        assert s.done == case["stats"]["done"]
    assert FIX["perfectToday"][0]["stats"]["perfect"] == 0
