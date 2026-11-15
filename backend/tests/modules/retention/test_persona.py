"""The persona the nightly job stores and the "not on top of another push"
rule (retention/logic.py; pure)."""

from datetime import datetime, timedelta, timezone

from app.modules.retention import logic as L

EVEN = dict.fromkeys(
    ("habits", "tasks", "fitness", "nutrition", "focus", "finance", "screen"), 1
)


def _p(
    logs: dict[str, int],
    *,
    weights: dict[str, int] | None = None,
    turns: int = 0,
    days: int = 10,
) -> L.Persona:
    return L.persona_of(
        area_logs=logs,
        weights=EVEN if weights is None else weights,
        fern_turns=turns,
        log_days=days,
    )


def test_the_area_logged_most_is_the_archetype() -> None:
    p = _p({"tasks": 20, "habits": 5})
    assert p.archetype == "planner"
    # habits is 5/25 = 20%: under the 25% bar for a second one.
    assert p.secondary is None


def test_a_second_archetype_with_a_quarter_of_the_logs() -> None:
    p = _p({"habits": 12, "finance": 8})
    assert (p.archetype, p.secondary) == ("habit-builder", "money-tracker")


def test_food_and_training_both_count_for_body_tracker() -> None:
    p = _p({"habits": 8, "nutrition": 6, "fitness": 5})
    assert p.archetype == "body-tracker"
    assert p.secondary == "habit-builder"


def test_cold_start_uses_the_module_weights() -> None:
    weights = {**EVEN, "finance": 5, "habits": 2}
    p = _p({"tasks": 3}, weights=weights)  # under 10 logs
    assert p.archetype == "money-tracker"
    # Switched-off modules (weight 0) never win.
    assert _p({}, weights={**EVEN, "habits": 0}).archetype == "planner"


def test_no_logs_and_no_weights_is_no_archetype() -> None:
    p = _p({}, weights={})
    assert (p.archetype, p.secondary, p.tags) == (None, None, [])


def test_ties_keep_the_archetype_order() -> None:
    assert _p({"tasks": 10, "habits": 10}).archetype == "habit-builder"


def test_talker_when_fern_turns_reach_half_the_log_days() -> None:
    assert _p({"habits": 20}, turns=5, days=10).tags == ["talker"]
    assert _p({"habits": 20}, turns=4, days=10).tags == []
    assert _p({}, turns=3, days=0).tags == []


# ---------------------------------------------------------------- recent push

AT = datetime(2026, 11, 15, 11, 0, tzinfo=timezone.utc)


def _hold(now: datetime, last: datetime | None) -> str | None:
    return L.recent_push_hold(
        at=AT, now=now, last_push=last, late_limit=timedelta(hours=1)
    )


def test_no_recent_push_sends() -> None:
    assert _hold(AT, None) is None
    assert _hold(AT, AT - timedelta(minutes=45)) is None


def test_a_push_minutes_ago_makes_the_nudge_wait() -> None:
    assert _hold(AT, AT - timedelta(minutes=10)) == "wait"
    # 50 min after the nudge time a push 10 min ago clears at +85 min: past
    # the late limit, so the day's nudge is held back.
    late = AT + timedelta(minutes=50)
    assert _hold(late, late - timedelta(minutes=10)) == "skip"
    # Exactly at the limit still waits.
    edge = AT + timedelta(minutes=15)
    assert _hold(edge, edge) == "wait"
