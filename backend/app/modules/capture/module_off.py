"""Entries logged into a module switched off in Settings.

Off means off on every surface, but nothing the person says is lost: the
entry is still logged, and the reply carries one line per off module it
landed in, saying it won't show on Today, with a way to turn it back on.
Fern shows it as a ``module_off`` block under its reply; a capture shows it
as an info card.
"""

from collections.abc import Iterable

from app.modules.profile import public as profile_public
from app.shared.context import Ctx

# Kinds that change or run something already there, not a new entry: the
# person is already dealing with that record, so no line about Today.
_NOT_NEW = frozenset({"edit", "remove", "command", "routineStart"})
# Meals carry the Fitness target (one target since before Nutrition was its
# own module, ADR-0024) but belong to Nutrition.
_NUTRITION_KINDS = frozenset({"meal"})
# Where an app too old for the in-place switch sends the person instead.
SETTINGS_HREF = "/me/settings"


def module_of(kind: str, target: str) -> str | None:
    """The module a new card's entry lands in, or None for a change to an
    existing record or a part outside the switchable modules."""
    if kind in _NOT_NEW:
        return None
    if target == "fitness" and kind in _NUTRITION_KINDS:
        return "nutrition"
    return target if target in profile_public.MODULE_LABEL else None


def line(module: str) -> str:
    label = profile_public.MODULE_LABEL[module]
    return f"{label} is off, so this won't show on Today. Turn it on?"


def off_written(ctx: Ctx, written: Iterable[tuple[str, str]]) -> list[str]:
    """The off modules among ``written`` (each a new card's kind and
    target), once each, in the order first written."""
    shut = set(profile_public.modules_off(ctx))
    seen: list[str] = []
    for kind, target in written:
        m = module_of(kind, target)
        if m is not None and m in shut and m not in seen:
            seen.append(m)
    return seen


def info_card(module: str) -> dict[str, object]:
    """The capture screen's info card for an entry in an off module."""
    label = profile_public.MODULE_LABEL[module]
    return {
        "t": "info",
        "tone": "module_off",
        "title": f"{label} is off",
        "body": "Saved, but it won't show on Today while it's off.",
        "actions": [
            {
                "label": f"Turn on {label}",
                "do": "module_on",
                "module": module,
                "href": SETTINGS_HREF,
            }
        ],
    }
