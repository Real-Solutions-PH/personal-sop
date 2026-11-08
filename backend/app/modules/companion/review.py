"""Fern's review of a range: the way back after missed days, or a week.

Wins first, then at most two gaps, each with how to improve it and one tiny
suggestion the person can make a habit or a task with one tap.

- Facts come only from the person's own records in the range and the week
  before it (day rings, habits, tasks finished), each with an id. Weigh-ins,
  body measurements and calorie targets are never read (care boundary).
- A model is available (``resolve_model(ctx, "chat")``) and the AI switch and
  spend cap allow it: one call, metered in ``ai_usage``, kept in
  ``fern_review`` per range until the facts change (``fingerprint``).
- Every point must cite fact ids it was given; anything else, anything about
  weight or the body, and any suggestion already dismissed or already a
  habit or open task is dropped on the server.
- AI off, cap reached or no model: a rules review of the same facts
  (``source="rules"``), not kept.
- The provider fails or answers with nothing usable: 503 ``review_failed``.
"""

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from sqlalchemy.exc import IntegrityError
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.companion.models import FernReview
from app.modules.companion.schema import (
    ReviewGap,
    ReviewIn,
    ReviewOut,
    ReviewPoint,
    ReviewSuggestion,
)
from app.modules.habits import public as habits_public
from app.modules.stats import public as stats_public
from app.modules.tasks import public as tasks_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import domain_error

MAX_WINS = 3
MAX_GAPS = 2
MAX_CHARS = 240
TITLE_CHARS = 60

SYSTEM = (
    "You are Fern, the coach inside the Unfurl habit and life tracker. You "
    "speak to the person directly, warmly and plainly, in second person. "
    "You never shame, never pad, and never invent facts that are not in the "
    "data you are given."
)

PROMPT = """Review the person's {what} ({first} to {last}) from the facts below.

Order: wins first (1 to 3), then at most two gaps that can be improved.
For each gap say how to improve it, and give ONE suggestion: a small first
step with a frequency, e.g. "10-minute walk after lunch" 3 days a week, never
an outcome goal. kind is "habit" for something repeated, "task" for a
one-off. Titles at most 60 characters.
A fact that is missing is unknown, not zero: never say they did nothing.
Never mention weight, the body, appearance, calories or diet.
Every win and gap cites the ids of the facts it rests on.

Reply with JSON only:
{{"wins": [{{"text": "...", "fact_ids": ["f1"]}}],
 "gaps": [{{"text": "...", "how": "...",
   "suggestion": {{"kind": "habit", "title": "...", "days_per_week": 3}},
   "fact_ids": ["f2"]}}]}}
No markdown, no greetings. Each text one sentence of at most 25 words.

Facts:
{facts}"""

BODY_TERMS = re.compile(
    r"\b(weight|weigh\w*|kgs?|kilos?|lbs?|pounds?|fat|calories?|kcal|diet\w*|"
    r"bmi|body|bodies|slim\w*|belly|waist|thin|skinny|obese|overweight)\b",
    re.I,
)
_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_DECODER = json.JSONDecoder()


@dataclass(frozen=True)
class Facts:
    rows: list[dict[str, Any]]
    # Names that must not come back as a suggestion (lower case).
    taken: frozenset[str]
    # The two most-missed habits in the range, for the rules review.
    most_missed: list[tuple[str, int, int]]

    @property
    def ids(self) -> set[str]:
        return {r["id"] for r in self.rows}

    @property
    def fingerprint(self) -> str:
        """The range's facts only: a habit's live streak moves with every
        later tick, so it is shown to the model but never keys the cache."""
        stable = [{k: v for k, v in r.items() if k != "streak"} for r in self.rows]
        blob = json.dumps(stable, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode()).hexdigest()


def _days(first: date, last: date) -> Iterable[date]:
    d = first
    while d <= last:
        yield d
        d += timedelta(days=1)


def facts(ctx: Ctx, first: date, last: date) -> Facts:
    rows: list[dict[str, Any]] = []

    def add(row: dict[str, Any]) -> None:
        rows.append({"id": f"f{len(rows) + 1}", **row})

    for day in _days(first, last):
        ring = stats_public.day_ring(ctx, day=day)
        if ring.due:
            add(
                {
                    "type": "day",
                    "day": day.isoformat(),
                    "done": ring.done,
                    "due": ring.due,
                    "on_target": ring.on_target,
                }
            )
    before = [
        stats_public.day_ring(ctx, day=d)
        for d in _days(first - timedelta(days=7), first - timedelta(days=1))
    ]
    scored = [r for r in before if r.due]
    if scored:
        add(
            {
                "type": "week_before",
                "on_target_days": sum(1 for r in scored if r.on_target),
                "scored_days": len(scored),
            }
        )
    logs = habits_public.log_facts(ctx, first, last)
    misses = stats_public.misses(ctx, first=first, last=last)
    habits = [h for h in habits_public.list_habits(ctx) if h.status != "archived"]
    ranked: list[tuple[str, int, int]] = []
    for h in habits:
        done = len(
            {
                g["day"]
                for g in logs
                if g["habit"] == h.name and g["status"] in ("done", "partial")
            }
        )
        missed = sum(
            1
            for m in misses
            if m.module == "habits"
            and m.id.startswith(f"miss-{h.id}-")
            and m.day <= last
        )
        if not done and not missed:
            continue
        add(
            {
                "type": "habit",
                "habit": h.name,
                "done_days": done,
                "missed_days": missed,
                "streak": habits_public.current_streak(ctx, habit_id=h.id),
            }
        )
        if missed:
            ranked.append((h.name, missed, done))
    finished = [
        t["task"] for t in tasks_public.task_facts(ctx, first, last) if t["done"]
    ]
    if finished:
        add({"type": "tasks_done", "count": len(finished), "titles": finished[:8]})
    open_titles = [
        t.title for t in tasks_public.list_open_tasks(ctx, order="newest", limit=200)
    ]
    taken = frozenset(
        n.strip().lower() for n in [*(h.name for h in habits), *open_titles]
    )
    ranked.sort(key=lambda r: (-r[1], r[0]))
    return Facts(rows=rows, taken=taken, most_missed=ranked[:MAX_GAPS])


# ---------------------------------------------------------------- checks


def _clean(text: Any, limit: int = MAX_CHARS) -> str:
    return " ".join(str(text or "").split())[:limit]


def _cites(item: dict[str, Any], ids: set[str]) -> bool:
    cited = item.get("fact_ids")
    return (
        isinstance(cited, list)
        and bool(cited)
        and all(isinstance(c, str) and c in ids for c in cited)
    )


def _body_talk(*texts: str) -> bool:
    return any(BODY_TERMS.search(t) for t in texts)


def validated(
    raw: dict[str, Any], f: Facts, dismissed: Iterable[str]
) -> tuple[list[ReviewPoint], list[ReviewGap]]:
    """Only what cites given facts, stays off the body, and is not already
    dismissed or already the person's; wins capped at 3, gaps at 2."""
    ids = f.ids
    banned = f.taken | {d.strip().lower() for d in dismissed}
    wins: list[ReviewPoint] = []
    for w in raw.get("wins") or []:
        if not isinstance(w, dict) or not _cites(w, ids):
            continue
        text = _clean(w.get("text"))
        if text and not _body_talk(text):
            wins.append(ReviewPoint(text=text))
    gaps: list[ReviewGap] = []
    for g in raw.get("gaps") or []:
        if not isinstance(g, dict) or not _cites(g, ids):
            continue
        s = g.get("suggestion")
        if not isinstance(s, dict) or s.get("kind") not in ("habit", "task"):
            continue
        title = _clean(s.get("title"), TITLE_CHARS)
        text, how = _clean(g.get("text")), _clean(g.get("how"))
        if not (title and text and how) or title.lower() in banned:
            continue
        if _body_talk(text, how, title):
            continue
        per = s.get("days_per_week")
        days = per if isinstance(per, int) and 1 <= per <= 7 else None
        gaps.append(
            ReviewGap(
                text=text,
                how=how,
                suggestion=ReviewSuggestion(
                    kind=s["kind"],
                    title=title,
                    days_per_week=days if s["kind"] == "habit" else None,
                ),
            )
        )
    return wins[:MAX_WINS], gaps[:MAX_GAPS]


# ---------------------------------------------------------------- rules


def rules_review(f: Facts, kind: str, dismissed: Iterable[str]) -> ReviewOut:
    """Wins and gaps from the facts alone, for when no model may run."""
    days = [r for r in f.rows if r["type"] == "day"]
    hits = sum(1 for r in days if r["on_target"])
    wins: list[ReviewPoint] = []
    if hits:
        wins.append(
            ReviewPoint(text=f"You hit your target on {hits} of {len(days)} days.")
        )
    top = max(
        (r for r in f.rows if r["type"] == "habit"),
        key=lambda r: r["streak"],
        default=None,
    )
    if top is not None and top["streak"] >= 2:
        wins.append(ReviewPoint(text=f"{top['habit']}: {top['streak']} days in a row."))
    done = next((r for r in f.rows if r["type"] == "tasks_done"), None)
    if done is not None:
        n = done["count"]
        wins.append(ReviewPoint(text=f"You finished {n} task{'s' if n != 1 else ''}."))
    if not wins:
        wins.append(
            ReviewPoint(
                text="You came back. That's the step that counts."
                if kind == "way_back"
                else "You kept tracking this week."
            )
        )
    banned = {d.strip().lower() for d in dismissed}
    gaps: list[ReviewGap] = []
    for name, missed, done_days in f.most_missed:
        title = f"Plan when to do {name} this week"[:TITLE_CHARS]
        if title.lower() in banned or title.lower() in f.taken:
            continue
        n = max(2, done_days + 1)
        gaps.append(
            ReviewGap(
                text=f"{name} slipped on {missed} day{'s' if missed != 1 else ''}.",
                how=f"Start with {n} days a week — a smaller target you can hit.",
                suggestion=ReviewSuggestion(kind="task", title=title),
            )
        )
    return ReviewOut(wins=wins[:MAX_WINS], gaps=gaps[:MAX_GAPS], source="rules")


# ---------------------------------------------------------------- model


def _json(text: str | None) -> dict[str, Any] | None:
    if not text:
        return None
    body = _THINK.sub("", text)
    at = body.find("{")
    while at >= 0:
        try:
            obj, _ = _DECODER.raw_decode(body, at)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and ("wins" in obj or "gaps" in obj):
            return obj
        at = body.find("{", at + 1)
    return None


def _ask(ctx: Ctx, resolved: ai.ResolvedModel, text: str) -> str | None:
    model = ai.build_chat_model(resolved)
    msgs: list[BaseMessage] = [SystemMessage(SYSTEM), HumanMessage(content=text)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - any provider failure is the card's error state
        ai.record_usage(
            ctx, resolved, input_tokens=0, output_tokens=0, cost_minor=0, ok=False
        )
        return None
    meta = (
        (getattr(out, "usage_metadata", None) or {})
        if isinstance(out, AIMessage)
        else {}
    )
    i, o = int(meta.get("input_tokens") or 0), int(meta.get("output_tokens") or 0)
    ai.record_usage(
        ctx,
        resolved,
        input_tokens=i,
        output_tokens=o,
        cost_minor=ai.price_minor(resolved.model, i, o),
    )
    content = out.content
    return content if isinstance(content, str) else str(content)


def _model(ctx: Ctx) -> ai.ResolvedModel | None:
    resolved = ai.resolve_model(ctx, "chat")
    if resolved is None:
        return None
    try:
        ai.check_budget(ctx)
    except HTTPException:
        return None
    return resolved


def _kept(ctx: Ctx, data: ReviewIn) -> FernReview | None:
    return owned_repo.find_one(
        ctx,
        FernReview,
        (col(FernReview.kind) == data.kind)
        & (col(FernReview.from_day) == data.from_day)
        & (col(FernReview.to_day) == data.to_day),
        include_deleted=True,
    )


def _keep(ctx: Ctx, data: ReviewIn, f: Facts, raw: dict[str, Any], model: str) -> None:
    row = _kept(ctx, data)
    if row is None:
        savepoint = ctx.session.begin_nested()
        try:
            owned_repo.insert(
                ctx,
                FernReview,
                {
                    "kind": data.kind,
                    "from_day": data.from_day,
                    "to_day": data.to_day,
                    "fingerprint": f.fingerprint,
                    "body": raw,
                    "model": model,
                },
            )
        except IntegrityError:
            # Another open kept its answer first; theirs stands.
            savepoint.rollback()
            return
        savepoint.commit()
        return
    row.fingerprint = f.fingerprint
    row.body = raw
    row.model = model
    row.deleted_at = None
    row.updated_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()


def review(ctx: Ctx, data: ReviewIn) -> ReviewOut:
    last = min(data.to_day, ctx.today)
    f = facts(ctx, data.from_day, last)
    kept = _kept(ctx, data)
    if (
        kept is not None
        and kept.deleted_at is None
        and kept.fingerprint == f.fingerprint
    ):
        wins, gaps = validated(kept.body, f, data.dismissed)
        return ReviewOut(wins=wins, gaps=gaps, source="ai")
    resolved = _model(ctx)
    if resolved is None:
        return rules_review(f, data.kind, data.dismissed)
    what = "way back after days away" if data.kind == "way_back" else "week"
    answer = _ask(
        ctx,
        resolved,
        PROMPT.format(
            what=what,
            first=data.from_day.isoformat(),
            last=last.isoformat(),
            facts=json.dumps(f.rows, ensure_ascii=False),
        ),
    )
    raw = _json(answer)
    if raw is None:
        ctx.commit()  # the metered call stands even though the answer failed
        raise domain_error(
            503, "review_failed", "Fern could not put your review together. Try again."
        )
    wins, gaps = validated(raw, f, data.dismissed)
    _keep(ctx, data, f, raw, resolved.model)
    ctx.commit()
    return ReviewOut(wins=wins, gaps=gaps, source="ai")
