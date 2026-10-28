"""Nutrition values a meal item can't have, found before it is saved.

The assistant's estimates went in unchecked: an "unsweetened" drink kept
22 g sugar against 12 g carbs, and items carried no portion weight, so a
chicken quarter could be priced as a thigh with nothing on record to show
it. These checks run on what the assistant sends; each problem names what
is wrong and the numbers involved, so the next call can fix it.

``value_problems`` holds for any values (an edit, a label read). Estimates
also owe their weight in grams and their sugar and sodium, which the daily
limits are counted from.
"""

from collections.abc import Mapping
from typing import Any

# Labels round each line to the gram, so a part may read a little over
# its whole.
SLACK_G = 0.5
# Energy from the macros may differ from the stated kcal by fiber (about
# 2 kcal/g, not 4), polyols and rounding: at least this much, or this share.
KCAL_SLACK = 30.0
KCAL_SHARE = 0.25
# Pure fat is 900 kcal per 100 g; nothing eaten is denser.
MAX_KCAL_PER_100G = 900.0

Problem = dict[str, Any]


def _num(item: Mapping[str, Any], key: str) -> float | None:
    v = item.get(key)
    return None if v is None else float(v)


_INVOLVES = {
    "sugar_more_than_carbs": {"sugar", "carbs"},
    "fiber_more_than_carbs": {"fiber", "carbs"},
    "sat_fat_more_than_fat": {"sat_fat", "fat"},
    "kcal_does_not_match_macros": {"kcal", "protein", "carbs", "fat"},
}


def involves(problem: Problem) -> set[str]:
    """The values a ``value_problems`` problem is about."""
    return _INVOLVES.get(str(problem["problem"]), set())


def kcal_from_macros(item: Mapping[str, Any]) -> float | None:
    """Atwater energy (4/4/9, alcohol 7), or None when a macro is missing."""
    p, c, f = (_num(item, k) for k in ("protein", "carbs", "fat"))
    if p is None or c is None or f is None:
        return None
    return 4 * p + 4 * c + 9 * f + 7 * (_num(item, "alcohol") or 0)


def value_problems(item: Mapping[str, Any]) -> list[Problem]:
    out: list[Problem] = []
    carbs, fat = _num(item, "carbs"), _num(item, "fat")
    for part, whole, whole_value in (
        ("sugar", "carbs", carbs),
        ("fiber", "carbs", carbs),
        ("sat_fat", "fat", fat),
    ):
        v = _num(item, part)
        if v is not None and whole_value is not None and v > whole_value + SLACK_G:
            out.append(
                {"problem": f"{part}_more_than_{whole}", part: v, whole: whole_value}
            )
    kcal, expected = _num(item, "kcal"), kcal_from_macros(item)
    if kcal is not None and expected is not None:
        if abs(kcal - expected) > max(KCAL_SLACK, KCAL_SHARE * max(kcal, expected)):
            out.append(
                {
                    "problem": "kcal_does_not_match_macros",
                    "kcal": kcal,
                    "kcal_from_macros": round(expected),
                    "fix": "kcal is about 4 x protein + 4 x carbs + 9 x fat "
                    "(+ 7 x alcohol); correct whichever is wrong",
                }
            )
    return out


def estimate_problems(item: Mapping[str, Any]) -> list[Problem]:
    """``value_problems`` plus what an estimate must state."""
    out = value_problems(item)
    grams = _num(item, "grams")
    if not grams:
        out.append(
            {
                "problem": "grams_missing",
                "fix": "give the edible grams this amount weighs (no bone or "
                "shell), e.g. 1 chicken breast quarter about 150 g",
            }
        )
    else:
        kcal = _num(item, "kcal") or 0
        if kcal / grams * 100 > MAX_KCAL_PER_100G:
            out.append(
                {"problem": "more_than_900_kcal_per_100g", "kcal": kcal, "grams": grams}
            )
        mass = sum(_num(item, k) or 0 for k in ("protein", "carbs", "fat"))
        if mass > grams + SLACK_G:
            out.append(
                {
                    "problem": "macros_heavier_than_the_food",
                    "macros_g": mass,
                    "grams": grams,
                }
            )
    missing = [k for k in ("sugar", "sodium") if item.get(k) is None]
    if missing:
        out.append(
            {
                "problem": "estimate_sugar_and_sodium",
                "missing": missing,
                "fix": "estimate them too (0 when there is none); the daily "
                "limits are counted from them",
            }
        )
    return out
