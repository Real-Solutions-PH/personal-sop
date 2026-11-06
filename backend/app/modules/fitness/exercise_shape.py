"""An exercise's shape (equipment, primary muscle, load type) read off its
name, for an exercise made without one.

Kai, 2026-11-06: exercises Fern added came out as a barbell chest lift
whatever their name ("Bulgarian split squat" included), because a new
exercise took the form's defaults. A new exercise now starts from what its
name says: "Bulgarian split squat" is a weighted dumbbell quads lift.

Muscles come from ``models.MUSCLES``: a rule naming a muscle the list does
not have (yet) is skipped, so muscles added to the list are used as soon as
they are there, and the guess never writes a value the table refuses.
"""

import re
from typing import Any

from app.modules.fitness.models import EQUIPMENT, LOAD_TYPES, MUSCLES

# Most specific first: the first rule whose pattern is in the name wins.
_MUSCLE_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"\babduct", ("abductors", "glutes")),
    (r"\badduct", ("adductors", "quads")),
    (r"\b(calf|calves)\b", ("calves",)),
    (r"\b(wrist|forearms?|farmers?|grip)\b", ("forearms",)),
    (
        r"\b(treadmill|run(ning)?|jog(ging)?|walk(ing)?|cycl(e|ing)|bike|"
        r"elliptical|rower|rowing machine|jump rope|skipping|stair|swim(ming)?|"
        r"burpees?|hiit|sprints?)\b",
        ("cardio",),
    ),
    (
        r"\b(plank|crunch(es)?|sit ?ups?|abs?|core|leg raises?|hanging raises?|"
        r"russian twists?|ab wheel|rollouts?|dead ?bugs?|hollow|pallof|"
        r"wood ?chop(per)?s?|mountain climbers?)\b",
        ("core",),
    ),
    (r"\b(leg curls?|hamstrings?|nordic|good ?mornings?)\b", ("hamstrings",)),
    (
        r"\b(romanian|rdl|stiff[ -]?leg(ged)?|single[ -]leg deadlift)\b",
        ("hamstrings",),
    ),
    (r"\b(hip thrusts?|glutes?|bridges?|kickbacks?|swings?)\b", ("glutes",)),
    (
        r"\b(squats?|lunges?|leg press|leg extensions?|step[ -]?ups?|"
        r"split squats?|sissy|wall sits?)\b",
        ("quads",),
    ),
    (r"\b(deadlifts?|rack pulls?)\b", ("back",)),
    (r"\b(upright rows?|face pulls?|rear delts?|reverse fl(y|ies))\b", ("shoulders",)),
    (
        r"\b(triceps?|pushdowns?|push downs?|skull ?crushers?|dips?|"
        r"close[ -]grip|overhead extensions?|french press)\b",
        ("triceps",),
    ),
    (r"\b(biceps?|curls?|chin[ -]?ups?)\b", ("biceps",)),
    (
        r"\b(rows?|pull[ -]?downs?|pull[ -]?ups?|lats?|shrugs?|back|"
        r"pullovers?|hyperextensions?|back extensions?|supermans?)\b",
        ("back",),
    ),
    (
        r"\b(overhead press|ohp|shoulders?|military|arnold|lateral raises?|"
        r"front raises?|side raises?|delts?|face pulls?|upright rows?|"
        r"reverse fl(y|ies)|rear delt)\b",
        ("shoulders",),
    ),
    (
        r"\b(bench|chest|incline|decline|fl(y|ies|yes)|pec|push[ -]?ups?|press[ -]?ups?|"
        r"crossovers?|butterfly)\b",
        ("chest",),
    ),
    (r"\bpress\b", ("shoulders",)),
)
_EQUIPMENT_WORDS: tuple[tuple[str, str], ...] = (
    (r"\b(barbell|bb|ez[ -]?bar|trap bar|hex bar|smith)\b", "barbell"),
    (r"\b(dumbbells?|db|kettlebells?|kb)\b", "dumbbell"),
    (r"\b(cables?|pulley|rope|face pulls?|pushdowns?|crossovers?)\b", "cable"),
    (
        r"\b(machine|leg press|leg extensions?|leg curls?|hack squat|pec deck|"
        r"pull[ -]?downs?|treadmill|bike|elliptical|rower|stair|seated calf|"
        r"chest press|hip abduct\w*|hip adduct\w*)\b",
        "machine",
    ),
    (
        r"\b(bodyweight|push[ -]?ups?|press[ -]?ups?|pull[ -]?ups?|chin[ -]?ups?|"
        r"dips?|plank|crunch(es)?|sit ?ups?|burpees?|air squats?|pistol|"
        r"mountain climbers?|nordic|hanging|run(ning)?|jog(ging)?|walk(ing)?|"
        r"jump rope|skipping|swim(ming)?|sprints?|wall sits?|dead ?bugs?|"
        r"hollow|superman|back extensions?|hyperextensions?|sissy)\b",
        "bodyweight",
    ),
)
# Lifts usually done with dumbbells when the name names no equipment.
_DUMBBELL_BY_DEFAULT = (
    r"\b(split squats?|lunges?|step[ -]?ups?|goblet|lateral raises?|"
    r"front raises?|side raises?|hammer|concentration|arnold|kickbacks?|"
    r"fl(y|ies|yes)|shrugs?|curls?|farmers?|single[ -]arm|one[ -]arm)\b"
)
_TIMED = (
    r"\b(plank|hold|wall sits?|hang|treadmill|run(ning)?|jog(ging)?|"
    r"walk(ing)?|cycl(e|ing)|bike|elliptical|rower|rowing machine|stair|"
    r"swim(ming)?|jump rope|skipping|hollow)\b"
)
_TIMED_SPEED = r"\b(treadmill|run(ning)?|jog(ging)?|walk(ing)?)\b"
# Fallbacks, as before: what the exercise form starts from.
_DEFAULT = {"equipment": "barbell", "muscle": "chest", "load_type": "weight"}


def _fold(name: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", name.lower()))


def muscle_of(name: str) -> str:
    n = _fold(name)
    for pattern, muscles in _MUSCLE_RULES:
        if re.search(pattern, n):
            for m in muscles:
                if m in MUSCLES:
                    return m
    return _DEFAULT["muscle"]


def equipment_of(name: str) -> str:
    n = _fold(name)
    for pattern, gear in _EQUIPMENT_WORDS:
        if re.search(pattern, n):
            return gear
    if re.search(_DUMBBELL_BY_DEFAULT, n):
        return "dumbbell"
    return _DEFAULT["equipment"]


def guess(name: str) -> dict[str, Any]:
    """Equipment, muscle and load type (and a timed one's second number)
    for an exercise named ``name``; every value is one the table allows."""
    n = _fold(name)
    equipment = equipment_of(name)
    timed = bool(re.search(_TIMED, n))
    load = "time" if timed else "bodyweight" if equipment == "bodyweight" else "weight"
    out: dict[str, Any] = {
        "equipment": equipment,
        "muscle": muscle_of(name),
        "load_type": load,
    }
    if timed and re.search(_TIMED_SPEED, n):
        out["track"] = "speed"
    assert out["equipment"] in EQUIPMENT and out["load_type"] in LOAD_TYPES
    return out
