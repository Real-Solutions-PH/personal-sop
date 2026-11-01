"""Estimated active kcal of a workout (``calc.estimate_workout_kcal``). The
mobile app runs the identical algorithm, so every expected number here is
worked out by hand in the comments, never by calling the function."""

from datetime import UTC, datetime, timedelta

from app.modules.fitness import calc as C

START = datetime(2026, 10, 20, 7, 0, tzinfo=UTC)


def working(n: int) -> list[C.BurnSetS]:
    return [C.BurnSetS(kind="working", completed=True) for _ in range(n)]


def test_strength_45_min_12_sets_80_kg_is_moderate() -> None:
    # session 45 min, no timed sets -> remainder 45 min.
    # density = 12 / 45 * 10 = 2.67 < 3 -> MET 3.5.
    # (3.5 - 1) * 80 * 45 / 60 = 2.5 * 80 * 0.75 = 150.
    sets = [
        *working(12),
        # Ignored: a warm-up, and a set never ticked.
        C.BurnSetS(kind="warmup", completed=True),
        C.BurnSetS(kind="working", completed=False),
    ]
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=45),
        source="live",
        sets=sets,
        cardio=None,
        weigh_ins=[(START - timedelta(days=1), 80.0)],
    )
    assert kcal == 150


def test_walk_set_plus_vigorous_strength_remainder() -> None:
    # weight 80 kg. Session 50 min.
    # Walk: 20 min at 6 km/h (< 8 -> walking). v = 6 * 1000 / 60 = 100 m/min;
    #   VO2 = 0.1 * 100 = 10 ml/kg/min; kcal = 10 * 80 * 20 / 1000 * 5 = 80.
    # Remainder = 50 - 20 = 30 min; 10 working sets -> density
    #   10 / 30 * 10 = 3.33 >= 3 -> MET 5.0; (5 - 1) * 80 * 30 / 60 = 160.
    # Total 80 + 160 = 240.
    walk = C.BurnSetS(kind="working", completed=True, duration_sec=1200, speed_kmh=6)
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=50),
        source="live",
        sets=[walk, *working(10)],
        cardio=None,
        weigh_ins=[(START - timedelta(hours=2), 80.0)],
    )
    assert kcal == 240


def test_a_running_set_uses_the_running_equation() -> None:
    # 70 kg (no weigh-in). Session 30 min, one 30-min set at 12 km/h
    # (>= 8 -> running): v = 200 m/min; VO2 = 0.2 * 200 = 40;
    # kcal = 40 * 70 * 30 / 1000 * 5 = 420. Remainder 30 - 30 = 0 -> + 0.
    run = C.BurnSetS(kind="working", completed=True, duration_sec=1800, speed_kmh=12)
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=30),
        source="live",
        sets=[run],
        cardio=None,
        weigh_ins=[],
    )
    assert kcal == 420


def test_chat_workout_counts_sets_not_placeholder_times() -> None:
    # Chat: the 60-minute placeholder is ignored. 75 kg.
    # 12 working sets -> remainder 12 * 2.5 = 30 min; density
    #   12 / 30 * 10 = 4 >= 3 -> MET 5.0; (5 - 1) * 75 * 30 / 60 = 150.
    # Cardio 5 km in 30 min: speed 5 / (30 / 60) = 10 km/h (running);
    #   v = 10000 / 60 = 166.67 m/min; VO2 = 0.2 * 166.67 = 33.33;
    #   kcal = 33.33 * 75 * 30 / 1000 * 5 = 375.
    # Total 150 + 375 = 525.
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=60),
        source="chat",
        sets=working(12),
        cardio={"activity": "run", "km": 5, "min": 30},
        weigh_ins=[(START - timedelta(days=3), 75.0)],
    )
    assert kcal == 525


def test_chat_cardio_alone_still_counts() -> None:
    # 70 kg, no sets. Cardio 3 km in 36 min: speed 3 / 0.6 = 5 km/h (walking);
    # v = 83.33 m/min; VO2 = 8.333; kcal = 8.333 * 70 * 36 / 1000 * 5 = 105.
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=60),
        source="chat",
        sets=[],
        cardio={"activity": "walk", "km": 3, "min": 36},
        weigh_ins=[],
    )
    assert kcal == 105


def test_no_weigh_in_means_70_kg() -> None:
    # 60 min, 6 working sets: density 6 / 60 * 10 = 1 -> MET 3.5.
    # (3.5 - 1) * 70 * 60 / 60 = 175.
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=60),
        source="live",
        sets=working(6),
        cardio=None,
        weigh_ins=[],
    )
    assert kcal == 175


def test_weight_is_the_latest_weigh_in_at_or_before_the_start() -> None:
    # Same 60 min / 6 sets (MET 3.5): 2.5 * kg * 1.
    # Weigh-ins: 90 kg two days before, 80 kg at the start, 60 kg after.
    # -> 80 kg -> 200.
    weigh_ins = [
        (START - timedelta(days=2), 90.0),
        (START, 80.0),
        (START + timedelta(hours=1), 60.0),
    ]
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=60),
        source="live",
        sets=working(6),
        cardio=None,
        weigh_ins=weigh_ins,
    )
    assert kcal == 200
    # Only weigh-ins after the start: the latest of all (62 kg) -> 155.
    later = [(START + timedelta(days=1), 60.0), (START + timedelta(days=2), 62.0)]
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=60),
        source="live",
        sets=working(6),
        cardio=None,
        weigh_ins=later,
    )
    assert kcal == 155


def test_remainder_is_capped_at_180_minutes() -> None:
    # 5 h session, 70 kg, 10 sets: remainder clamp(300, 0, 180) = 180;
    # density 10 / 180 * 10 = 0.56 -> MET 3.5; 2.5 * 70 * 180 / 60 = 525.
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(hours=5),
        source="live",
        sets=working(10),
        cardio=None,
        weigh_ins=[],
    )
    assert kcal == 525


def test_no_completed_sets_and_no_cardio_is_zero() -> None:
    kcal = C.estimate_workout_kcal(
        started_at=START,
        ended_at=START + timedelta(minutes=45),
        source="live",
        sets=[C.BurnSetS(kind="working", completed=False)],
        cardio=None,
        weigh_ins=[(START, 80.0)],
    )
    assert kcal == 0


def test_rounds_half_up() -> None:
    # 66 kg, 1 working set, 6 min: density 1 / 6 * 10 = 1.67 -> MET 3.5;
    # 2.5 * 66 * 6 / 60 = 16.5 -> 17 (half away from zero, not banker's 16).
    # 70 kg, 6 sets, 61 min: density 0.98 -> MET 3.5;
    # 2.5 * 70 * 61 / 60 = 177.92 -> 178.
    def burn(minutes: float, n: int, kg: float) -> int:
        return C.estimate_workout_kcal(
            started_at=START,
            ended_at=START + timedelta(minutes=minutes),
            source="live",
            sets=working(n),
            cardio=None,
            weigh_ins=[(START, kg)],
        )

    assert burn(6, 1, 66.0) == 17
    assert burn(61, 6, 70.0) == 178
