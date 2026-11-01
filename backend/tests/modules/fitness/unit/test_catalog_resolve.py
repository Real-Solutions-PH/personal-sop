"""The shared catalog's name matching: a create resolves to what exists.

The names are the ones Kai's build-23 workout shows ("Pec deck machine",
"Incline chest press machine", "Shoulder press", "Lateral raise one arm
cable", "Preacher curl hammer") and the variants Fern created beside them.
Pure functions: no database.
"""

from dataclasses import dataclass, field

import pytest

from app.modules.fitness import catalog
from app.modules.fitness.food_library import same_food


@dataclass
class Row:
    name: str
    aliases: list[str] = field(default_factory=list)


CATALOG = [
    Row("Pec deck machine"),
    Row("Incline chest press machine"),
    Row("Shoulder press"),
    Row("Lateral raise one arm cable"),
    Row("Preacher curl hammer"),
    Row("Lateral Raise"),
    Row("Barbell Bench Press"),
    Row("Reverse pec deck"),
    Row("Lat Pulldown"),
    Row("Dumbbell Curl"),
    Row("Cable Curl"),
]


def by_name(name: str) -> Row:
    return next(r for r in CATALOG if r.name == name)


@pytest.mark.parametrize(
    "said",
    [
        "Pec deck",
        "pec-deck",
        "Pec Deck Machine",
        "Pec deck fly",
        "Pec deck flyes",
        "Machine pec deck",
        "Butterfly",
        "Machine chest fly",
        "pec dec",
    ],
)
def test_every_pec_deck_variant_is_the_one_pec_deck(said: str) -> None:
    assert catalog.resolve_exercise(said, CATALOG) is by_name("Pec deck machine")


def test_the_rear_delt_pec_deck_stays_its_own_exercise() -> None:
    assert catalog.resolve_exercise("Reverse pec deck", CATALOG) is by_name(
        "Reverse pec deck"
    )
    assert catalog.resolve_exercise("Rear delt pec deck", CATALOG) is None


@pytest.mark.parametrize(
    ("said", "means"),
    [
        ("incline chest press", "Incline chest press machine"),
        ("Shoulder presses", "Shoulder press"),
        ("shoulder press machine", "Shoulder press"),
        ("Lateral raises", "Lateral Raise"),
        # The only lateral raise without one-arm cable: equipment words
        # alone never make a second exercise.
        ("Lateral raise machine", "Lateral Raise"),
        ("lateral raise one-arm cable", "Lateral raise one arm cable"),
        ("Hammer preacher curl", "Preacher curl hammer"),
        ("bench press", "Barbell Bench Press"),
        ("BB bench press", "Barbell Bench Press"),
        ("Lat pull-down machine", "Lat Pulldown"),
        ("lat pulldowns", "Lat Pulldown"),
        ("preacher curl hamer", "Preacher curl hammer"),
    ],
)
def test_variants_resolve_to_the_existing_exercise(said: str, means: str) -> None:
    assert catalog.resolve_exercise(said, CATALOG) is by_name(means)


def test_an_equipment_free_name_with_two_equipment_variants_is_not_guessed() -> None:
    # "Curl" could be the dumbbell or the cable one: nothing is reused.
    assert catalog.resolve_exercise("Curl", CATALOG) is None


@pytest.mark.parametrize(
    "said", ["Cable chest fly", "Leg press", "Squat", "Leg extension"]
)
def test_a_new_exercise_is_new(said: str) -> None:
    assert catalog.resolve_exercise(said, CATALOG) is None


def test_an_alias_resolves() -> None:
    rows = [Row("Pec deck machine", aliases=["Chest flys on the deck"])]
    assert catalog.resolve_exercise("chest fly on the deck", rows) is rows[0]


def test_two_rows_with_one_key_resolve_to_the_first() -> None:
    rows = [Row("Pec deck"), Row("Pec deck machine")]
    assert catalog.resolve_exercise("pec deck fly", rows) is rows[0]


def test_routines_resolve_by_folded_name_or_close_spelling() -> None:
    rows = [Row("Push A"), Row("Pull A"), Row("Legs A")]
    assert catalog.resolve_routine("push a", rows) is rows[0]
    assert catalog.resolve_routine("Legs  A!", rows) is rows[2]
    assert catalog.resolve_routine("Upper body", rows) is None


@dataclass
class Food:
    key: str
    aliases: list[str] = field(default_factory=list)
    id: int = 0


def test_foods_resolve_by_name_plural_alias_or_close_spelling() -> None:
    rows = [
        Food("japanese siomai", id=1),
        Food("fried egg", aliases=["egg fried"], id=2),
        Food("white rice cooked", id=3),
    ]
    assert same_food("Japanese siomai", rows) is rows[0]  # type: ignore[arg-type]
    assert same_food("japanese siomais", rows) is rows[0]  # type: ignore[arg-type]
    assert same_food("Fried eggs", rows) is rows[1]  # type: ignore[arg-type]
    assert same_food("egg, fried", rows) is rows[1]  # type: ignore[arg-type]
    assert same_food("japanese siomia", rows) is rows[0]  # type: ignore[arg-type]
    assert same_food("rice cake", rows) is None  # type: ignore[arg-type]
