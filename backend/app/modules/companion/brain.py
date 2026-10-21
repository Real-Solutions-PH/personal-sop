"""The companion's deterministic router: a port of
``mobile/src/prototype/companion/brain.ts`` ``route``.

It answers when no chat model resolves (ADR-0012). Pure: what the prototype
did to its store on the way (remember a fact, add a tracker) comes back as
an :class:`Effect` the service applies, so a tracker block can carry the
id of the row it made.

The prototype picked a greeting at random; the server always takes the first
phrasing, so the same message gets the same reply (the golden fixture pins
``Math.random`` to 0 for the same reason).
"""

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from app.modules.companion.defaults import COMPANION_NAME

A = re.ASCII

Metric = Literal[
    "life",
    "habits",
    "tasks",
    "spend",
    "spendCats",
    "netWorth",
    "workouts",
    "weight",
    "nutrition",
]

METRICS: list[tuple[Metric, str, str]] = [
    ("spendCats", "Where your money went", r"categor|where.*(money|spend)|breakdown"),
    ("netWorth", "Net worth", r"net ?worth|savings|saved|wealth"),
    ("spend", "Daily spending", r"spend|money|expense|bought|budget|gastos"),
    ("weight", "Weight", r"weigh|kg|body"),
    ("workouts", "Workouts", r"workout|training|gym|lift|run|exercise"),
    ("nutrition", "Calories", r"calor|protein|food|eat|meal|nutrition|macro"),
    ("habits", "Habit completion", r"habit|routine|streak"),
    ("tasks", "Tasks done", r"task|todo|to-do|productiv"),
    ("life", "Life score", r"score|life|overall|progress|everything|balance"),
]
LABELS: dict[str, str] = {m: label for m, label, _ in METRICS}


def metric_label(m: str) -> str:
    return LABELS.get(m, m)


def find_metric(q: str) -> Metric | None:
    return next((m for m, _, rx in METRICS if re.search(rx, q, A)), None)


def find_days(q: str) -> int:
    if re.search(r"year|12 months", q, A):
        return 365
    if re.search(r"quarter|3 months|90", q, A):
        return 90
    if re.search(r"week|7 days", q, A):
        return 7
    if re.search(r"today", q, A):
        return 7
    return 30


@dataclass(frozen=True)
class Effect:
    kind: Literal["remember", "track"]
    fact: str | None = None
    tracker: dict[str, Any] | None = None


@dataclass
class Route:
    kind: Literal["reply", "capture"]
    text: str = ""
    blocks: list[dict[str, Any]] = field(default_factory=list)
    effect: Effect | None = None

    def as_dict(self) -> dict[str, Any]:
        if self.kind == "capture":
            return {"kind": "capture"}
        out: dict[str, Any] = {"kind": "reply", "text": self.text}
        if self.blocks:
            out["blocks"] = self.blocks
        return out


def first_name(name: str) -> str:
    return (re.split(r"\s+", name.strip())[0] if name.strip() else "") or "friend"


def js_number(s: str | None) -> float | None:
    """``Number(s)`` where an unparsable string is NaN (``None`` here)."""
    if s is None:
        return None
    try:
        return float(s) if s.strip() else 0.0
    except ValueError:
        return None


def route(raw: str, *, user_name: str, sol_name: str = COMPANION_NAME) -> Route:
    q = raw.lower().strip()
    name = first_name(user_name)

    def t(rx: str) -> bool:
        return re.search(rx, q, A) is not None

    if t(r"^(hi|hey|hello|yo|good (morning|afternoon|evening)|kumusta|musta)\b"):
        return Route(
            "reply",
            f"Hey {name}! I'm here. Want a quick read on how today's going?",
            [
                {
                    "t": "chips",
                    "prompts": [
                        "How am I doing?",
                        "Plan my day",
                        "Show my spending this week",
                    ],
                }
            ],
        )
    if t(r"\b(thanks|thank you|salamat|ty)\b"):
        return Route("reply", "Anytime. I've got your back.")
    if t(
        r"(stress|tired|exhaust|sad|anxious|overwhelm|burn(ed|t) ?out|unmotivat|lazy|down"
        r"|can't focus|cant focus)"
    ):
        return Route(
            "reply",
            f"That sounds heavy, {name}. Let's make today smaller, not harder. "
            "Here's what I'm seeing, gently:",
            [
                {"t": "coach", "mood": "low"},
                {
                    "t": "chips",
                    "prompts": [
                        "Just one thing for today",
                        "Log how I feel in my journal",
                    ],
                },
            ],
        )
    if t(r"^remember( that)? "):
        fact = re.sub(r"^remember( that)?\s*", "", raw, flags=re.I | A).strip()
        said = re.sub(r"[.]\Z", "", fact)
        return Route(
            "reply",
            f"Got it — I'll remember that {said}.",
            [{"t": "memory"}],
            Effect("remember", fact=fact) if fact else None,
        )
    if t(r"(what do you know|about me|remember about me|my memories)"):
        return Route(
            "reply",
            "Here's what I know about you so far — tap one to forget it.",
            [{"t": "memory"}],
        )
    if t(r"(track|keep an eye|monitor|watch|alert me|notify me)"):
        metric: Metric = find_metric(q) or "life"
        m = re.search(
            r"(?:under|below|less than|max|at most|over|above|at least)\s*₱?\s*([\d,.]+)",
            q,
            A,
        )
        goal = js_number(m.group(1).replace(",", "")) if m else None
        has_goal = goal is not None and goal > 0
        direction = "above" if t(r"(over|above|at least)") else "below"
        tracker = {
            "metric": metric,
            "label": metric_label(metric),
            "goal": goal if has_goal else None,
            "direction": direction if has_goal else None,
        }
        return Route(
            "reply",
            f"Tracking {metric_label(metric).lower()} for you. I'll flag it on Today when it drifts.",
            [{"t": "tracker", "id": None}],
            Effect("track", tracker=tracker),
        )
    if t(r"(chart|graph|plot|visuali[sz]e|trend|over time|\bshow\b|breakdown|compare)"):
        metric = find_metric(q) or "life"
        days = find_days(q)
        label = metric_label(metric).lower()
        return Route(
            "reply",
            f"Here's your {label} for the last {'year' if days == 365 else f'{days} days'}.",
            [
                {"t": "chart", "metric": metric, "days": days},
                {"t": "chips", "prompts": [f"Track {label}", "What does this mean?"]},
            ],
        )
    if t(
        r"(plan my day|what should i do|what's next|whats next|priorit|today's plan"
        r"|todays plan|focus today)"
    ):
        return Route("reply", f"Here's how I'd run today, {name}:", [{"t": "plan"}])
    if t(
        r"(coach|feedback|evaluate|advice|improve|motivat|honest|what should i focus|tips"
        r"|be better|level up)"
    ):
        return Route("reply", "Honest read, coach hat on:", [{"t": "coach"}])
    if t(
        r"(insight|pattern|notice|analy[sz]e|how am i doing|how'?s my|how is my|review|recap"
        r"|summary|this mean)"
    ):
        return Route(
            "reply",
            "Here's what stands out from your records:",
            [
                {"t": "insights"},
                {
                    "t": "chips",
                    "prompts": ["Coach me on this", "Show my life score this month"],
                },
            ],
        )
    if t(r"(who are you|what can you do|help$|^help)"):
        return Route(
            "reply",
            f"I'm {sol_name}, your companion inside Personal SOP. I know your habits, tasks, "
            "training, food, money and journal — and I remember what you tell me. I can log "
            "things for you, spot patterns, chart anything, coach you, and keep an eye on what "
            "matters.",
            [
                {
                    "t": "chips",
                    "prompts": [
                        "How am I doing?",
                        "Chart my workouts",
                        "Track spending under 1500",
                        "Coach me",
                    ],
                }
            ],
        )
    # Logging and specific questions go through the capture engine.
    return Route("capture")
