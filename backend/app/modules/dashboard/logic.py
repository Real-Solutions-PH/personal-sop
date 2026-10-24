"""Pure rules of the dashboard module: share templates and their fields,
onboarding paces and starter goals, review keys and metric refs.

Ported from ``shared/prototype/dash/{share-data,onboarding,store}.ts``; the
tables are pinned to the prototype by ``tests/golden/dashboard-tables.json``.
"""

import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from app.shared.currency import contains_money

MODULE_KEYS: tuple[str, ...] = (
    "habits",
    "tasks",
    "fitness",
    "nutrition",
    "focus",
    "finance",
)

ShareTemplate = Literal[
    "life", "weekly", "monthly", "streak", "finance", "profile", "goal"
]
Pace = Literal["gentle", "steady", "ambitious"]


@dataclass(frozen=True)
class ShareField:
    key: str
    label: str
    on: bool
    sensitive: str | None = None


COMMON: tuple[ShareField, ...] = (
    ShareField("mark", "App mark", True),
    ShareField("handle", "Handle", False, "Identifies you"),
    ShareField("dates", "Date range", True),
)

TEMPLATES: dict[str, tuple[str, tuple[str, ...], tuple[ShareField, ...]]] = {
    "life": ("Life Score", ("9:16", "4:5", "1:1"), (
        ShareField("level", "Level", True),
        ShareField("hexagon", "Area hexagon", True),
        ShareField("areas", "Area bars (when hexagon is off)", False),
        ShareField("delta", "Change vs last month", True),
    )),
    "weekly": ("Weekly recap", ("9:16", "4:5", "1:1"), (
        ShareField("hexagon", "Area hexagon", True),
        ShareField("onTarget", "On-target rate", True),
        ShareField("habits", "Habit %", True),
        ShareField("training", "Training days", True),
        ShareField("savings", "Savings rate %", True),
        ShareField("deltas", "▲▼ vs last week", True),
        ShareField("trophy", "Top achievement", True),
    )),
    "monthly": ("Monthly recap", ("9:16", "4:5", "1:1"), (
        ShareField("hexagon", "Area hexagon", True),
        ShareField("hero", "4 hero stats", True),
        ShareField("prs", "PR count", True),
        ShareField("streak", "Best streak", True),
        ShareField("highlight", "Month highlight", True),
    )),
    "streak": ("Streak", ("9:16", "4:5", "1:1"), (
        ShareField("grid", "30-day grid", True),
        ShareField("best", "Best streak", True),
    )),
    "finance": ("Finance %", ("9:16", "4:5", "1:1"), (
        ShareField("savings", "Savings rate", True),
        ShareField("spend", "Spending vs last month %", True),
        ShareField("budgets", "Budgets kept", True),
        ShareField("nospend", "No-spend days", True),
    )),
    "profile": ("Profile card", ("9:16",), (
        ShareField("hexagon", "Area hexagon", True),
        ShareField("photo", "Profile photo", False, "Shows your face"),
        ShareField("records", "Personal bests", True),
        ShareField("identity", "Identity statements", False, "Personal text"),
    )),
    "goal": ("Goal hit", ("9:16", "4:5", "1:1"), (
        ShareField("target", "Target", True),
    )),
}  # fmt: skip


def template_fields(template: str) -> tuple[ShareField, ...]:
    return COMMON + TEMPLATES[template][2]


def resolve_fields(template: str, saved: Mapping[str, bool] | None) -> dict[str, bool]:
    """The template's defaults overlaid with the user's saved choices (keys
    the template no longer has are dropped)."""
    out = {f.key: f.on for f in template_fields(template)}
    for k, v in (saved or {}).items():
        if k in out:
            out[k] = bool(v)
    return out


def unknown_fields(template: str, fields: Mapping[str, Any]) -> list[str]:
    known = {f.key for f in template_fields(template)}
    return sorted(k for k in fields if k not in known)


@dataclass(frozen=True)
class PaceSpec:
    label: str
    note: str
    targets: dict[str, float]


PACES: dict[str, PaceSpec] = {
    "gentle": PaceSpec("Gentle", "Easy wins first",
                       {"habits": 60, "tasks": 70, "fitness": 2, "nutrition": 60,
                        "focus": 3, "finance": 10}),
    "steady": PaceSpec("Steady", "A real stretch",
                       {"habits": 80, "tasks": 85, "fitness": 4, "nutrition": 75,
                        "focus": 5, "finance": 20}),
    "ambitious": PaceSpec("Ambitious", "No days off",
                          {"habits": 90, "tasks": 95, "fitness": 5, "nutrition": 90,
                           "focus": 6, "finance": 30}),
}  # fmt: skip


@dataclass(frozen=True)
class Starter:
    metric: str
    label: str
    target: float
    unit: str
    comparator: Literal["gte", "lte"]
    period: Literal["week", "month"]
    hint: str


STARTERS: dict[str, Starter] = {
    "habits": Starter("habits:habits.rate", "Habit completion", 80, "%", "gte",
                      "week", "of scheduled habits done"),
    "tasks": Starter("tasks:tasks.onTime", "On-time rate", 85, "%", "gte", "week",
                     "tasks done by their due date"),
    "fitness": Starter("fitness:sessions", "Workouts", 4, "", "gte", "week",
                       "sessions per week"),
    "nutrition": Starter("nutrition:protein", "Protein hit rate", 75, "%", "gte",
                         "week", "of logged days at your protein target"),
    "focus": Starter("focus:goalDays", "Days on focus goal", 5, "", "gte", "week",
                     "days you reach your focus goal"),
    "finance": Starter("finance:savings-rate", "Savings rate", 20, "%", "gte",
                       "month", "of income kept this month"),
}  # fmt: skip


# ---------------------------------------------------------------- refs and keys

_REF = re.compile(
    r"^(life|onTarget|(habits|tasks|fitness|nutrition|focus|finance):[A-Za-z0-9._-]{1,48})$"
)
_REVIEW = re.compile(r"^([wm])-(\d{4}-\d{2}-\d{2})$")


def valid_metric_ref(ref: str) -> bool:
    return bool(_REF.match(ref))


def review_period(key: str) -> tuple[Literal["week", "month"], date] | None:
    """``w-YYYY-MM-DD`` (a Monday) or ``m-YYYY-MM-DD`` (a 1st), else None."""
    m = _REVIEW.match(key)
    if m is None:
        return None
    try:
        start = date.fromisoformat(m.group(2))
    except ValueError:
        return None
    if m.group(1) == "w":
        return ("week", start) if start.weekday() == 0 else None
    return ("month", start) if start.day == 1 else None


def finite(x: float) -> bool:
    return not (math.isnan(x) or math.isinf(x))


# ---------------------------------------------------------------- share cards


def scrub_money(value: Any) -> Any:
    """IA ruling X-5: a share card never carries a money amount. Any string
    that names a currency is dropped (None); containers are scrubbed deeply."""
    if isinstance(value, str):
        return None if contains_money(value) else value
    if isinstance(value, dict):
        return {k: scrub_money(v) for k, v in value.items()}
    if isinstance(value, list):
        return [scrub_money(v) for v in value]
    return value


def budgets_pct(value: str) -> int | None:
    """ "3/4" -> 75 (``budgetsPct`` on the finance card)."""
    m = re.search(r"(\d+)\s*/\s*(\d+)", value, re.ASCII)
    if not m:
        return None
    return math.floor(int(m.group(1)) / max(1, int(m.group(2))) * 100 + 0.5)
