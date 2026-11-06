"""A new exercise's shape read off its name (``exercise_shape.guess``).

Kai, 2026-11-06: exercises Fern added came out as barbell chest lifts
whatever their name."""

import pytest

from app.modules.fitness import exercise_shape
from app.modules.fitness.models import EQUIPMENT, LOAD_TYPES, MUSCLES

# Expected shapes are how the lift is commonly done, hand-written here.
CASES = [
    ("Bulgarian split squat", "dumbbell", "quads", "weight"),
    ("Barbell back squat", "barbell", "quads", "weight"),
    ("Romanian deadlift", "barbell", "hamstrings", "weight"),
    ("Lying leg curl", "machine", "hamstrings", "weight"),
    ("Hip thrust", "barbell", "glutes", "weight"),
    ("Lat pulldown", "machine", "back", "weight"),
    ("Seated cable row", "cable", "back", "weight"),
    ("Pull-up", "bodyweight", "back", "bodyweight"),
    ("Push-ups", "bodyweight", "chest", "bodyweight"),
    ("Incline dumbbell press", "dumbbell", "chest", "weight"),
    ("Cable fly", "cable", "chest", "weight"),
    ("Lateral raise", "dumbbell", "shoulders", "weight"),
    ("Face pull", "cable", "shoulders", "weight"),
    ("Hammer curl", "dumbbell", "biceps", "weight"),
    ("Triceps pushdown", "cable", "triceps", "weight"),
    ("Dips", "bodyweight", "triceps", "bodyweight"),
    ("Standing calf raise", "barbell", "calves", "weight"),
    ("Plank", "bodyweight", "core", "time"),
    ("Treadmill walk", "machine", "cardio", "time"),
    ("Farmer's carry", "dumbbell", "forearms", "weight"),
]


@pytest.mark.parametrize(("name", "equipment", "muscle", "load"), CASES)
def test_the_name_gives_equipment_muscle_and_load_type(
    name: str, equipment: str, muscle: str, load: str
) -> None:
    got = exercise_shape.guess(name)
    assert (got["equipment"], got["muscle"], got["load_type"]) == (
        equipment,
        muscle,
        load,
    )


def test_every_guess_is_a_value_the_table_allows() -> None:
    for name, *_ in CASES:
        got = exercise_shape.guess(name)
        assert got["equipment"] in EQUIPMENT and got["muscle"] in MUSCLES
        assert got["load_type"] in LOAD_TYPES
    # An unreadable name keeps the old default rather than failing.
    assert exercise_shape.guess("Zercher thing") == {
        "equipment": "barbell",
        "muscle": "chest",
        "load_type": "weight",
    }


def test_a_timed_walk_tracks_speed() -> None:
    assert exercise_shape.guess("Treadmill walk")["track"] == "speed"
    assert "track" not in exercise_shape.guess("Plank")


def test_muscles_come_from_the_fitness_list(monkeypatch: pytest.MonkeyPatch) -> None:
    """A muscle added to ``models.MUSCLES`` is used as soon as it is there;
    until then the rule falls back to one the list has."""
    without = tuple(m for m in MUSCLES if m != "abductors")
    monkeypatch.setattr(exercise_shape, "MUSCLES", without)
    assert exercise_shape.muscle_of("Hip abduction machine") == "glutes"
    monkeypatch.setattr(exercise_shape, "MUSCLES", (*without, "abductors"))
    assert exercise_shape.muscle_of("Hip abduction machine") == "abductors"
