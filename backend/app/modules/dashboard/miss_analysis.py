"""Fern's short read of what slipped yesterday (the Yesterday page).

Yesterday is the person's own business day before today (``ctx.today`` is
derived from their time zone and day-start hour), never the UTC calendar.
The misses are exactly what the misses feed already counts
(``stats.public.misses``), restricted to that one day, so the page, the
Home card and the Misses page never disagree about what a miss is.

On demand only: the page asks when it opens, nothing runs on a schedule.

- Nothing missed: a celebration, no model call.
- A model is available (``resolve_model(ctx, "chat")``) and the AI switch
  and spend cap allow it: one call, metered in ``ai_usage``, and the answer
  is kept in ``miss_analysis`` for that day. Reopening the page returns the
  kept answer; it is redone only when the day's set of misses changed
  (``fingerprint``), e.g. a habit ticked late, not when a note is added.
- AI off, cap reached or no model at all: a short rules-based read of the
  same facts (``source="rules"``), not kept, since it costs nothing.
- The provider fails or answers with nothing usable: 503
  ``analysis_failed`` (the call still metered), nothing kept, so the page's
  Retry asks again.
"""

import hashlib
import json
import re
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from sqlalchemy.exc import IntegrityError
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.dashboard import public as dashboard_public
from app.modules.dashboard.models import MissAnalysis
from app.modules.stats import public as stats_public
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.domain import domain_error

MAX_POINTS = 3
MAX_POINT_CHARS = 240
WEEK = 7

SYSTEM = (
    "You are Fern, the coach inside the Unfurl habit and life tracker. You "
    "speak to the person directly, warmly and plainly, in second person. "
    "You never shame, never pad, and never invent facts that are not in the "
    "data you are given."
)

PROMPT = """Below is what the person missed yesterday ({day}) and what slipped \
in the week before it. Write a short analysis of yesterday:

1. what slipped, naming the pattern if there is one (the same thing \
missing on several days, one area taking most of the misses);
2. the likely cause, from the data and any note the person wrote (say \
"likely" when you are inferring);
3. one concrete redirection for today: a single, small, specific action.

Reply with JSON only: {{"points": ["...", "...", "..."]}} with exactly three \
points, each one sentence of at most 25 words. No markdown, no greetings.

Data:
{data}"""

_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)
_DECODER = json.JSONDecoder()
# The kind of note on the front of a miss's title ("Missed: Read") is not
# part of the thing's name.
_PREFIX = re.compile(
    r"^(Missed|Unpaid|Stalled|Overdue \d+d|Done \d+d late|Pushed \d+×):\s*"
)


@dataclass(frozen=True)
class YesterdayFacts:
    day: date
    misses: list[dict[str, Any]]
    week: list[dict[str, Any]]
    due: int
    done: int
    on_target: bool

    @property
    def fingerprint(self) -> str:
        ids = "\n".join(sorted(m["id"] for m in self.misses))
        return hashlib.sha256(ids.encode()).hexdigest()


@dataclass(frozen=True)
class Analysis:
    day: date
    state: Literal["celebrate", "analysis"]
    source: Literal["fern", "rules", "none"]
    points: list[str]
    misses: int
    due: int
    done: int
    on_target: bool


def yesterday(ctx: Ctx) -> date:
    return ctx.today - timedelta(days=1)


def facts(ctx: Ctx) -> YesterdayFacts:
    """Yesterday's misses (with the person's notes), the week before for
    patterns, and yesterday's ring."""
    day = yesterday(ctx)
    first = day - timedelta(days=WEEK - 1)
    # The feed can emit a miss dated after its window (a task pushed three
    # times shows on its future due day); yesterday means yesterday.
    span = [m for m in stats_public.misses(ctx, first=first, last=day) if m.day <= day]
    notes = dashboard_public.miss_notes(ctx, [m.id for m in span])

    def row(m: Any) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": m.id,
            "day": m.day.isoformat(),
            "area": m.module,
            "kind": m.kind,
            "title": m.title,
        }
        if notes.get(m.id):
            out["note"] = notes[m.id]
        return out

    ring = stats_public.day_ring(ctx, day=day)
    return YesterdayFacts(
        day=day,
        misses=[row(m) for m in span if m.day == day],
        week=[row(m) for m in span if m.day < day],
        due=ring.due,
        done=ring.done,
        on_target=ring.on_target,
    )


def _name(title: str) -> str:
    return _PREFIX.sub("", title).strip()


def _result(
    f: YesterdayFacts, source: Literal["fern", "rules", "none"], points: list[str]
) -> Analysis:
    return Analysis(
        day=f.day,
        state="analysis" if f.misses else "celebrate",
        source=source,
        points=points,
        misses=len(f.misses),
        due=f.due,
        done=f.done,
        on_target=f.on_target,
    )


def rules_points(f: YesterdayFacts) -> list[str]:
    """The same three beats from the data alone, for when no model may run."""
    n = len(f.misses)
    areas = Counter(m["area"] for m in f.misses)
    area, k = areas.most_common(1)[0]
    first = f"{n} thing{'s' if n != 1 else ''} slipped yesterday" + (
        f", {k} of them in {area}." if len(areas) > 1 else f", all in {area}."
    )
    seen = Counter(_name(m["title"]) for m in f.week)
    repeat = next((m for m in f.misses if seen.get(_name(m["title"]), 0) >= 2), None)
    noted = next((m for m in f.misses if m.get("note")), None)
    if noted is not None:
        cause = f'You noted "{noted["note"]}" on {_name(noted["title"])}.'
    elif repeat is not None:
        times = seen[_name(repeat["title"])] + 1
        cause = (
            f"{_name(repeat['title'])} slipped {times} of the last {WEEK} days, "
            "so it is a pattern, not a one-off."
        )
    elif f.due:
        cause = f"{f.done} of {f.due} done: the day likely ran out before the list did."
    else:
        cause = "Nothing was logged against the plan, so the day likely got away early."
    lead = repeat or f.misses[0]
    return [
        first,
        cause,
        f"Today, do {_name(lead['title'])} first, before anything else.",
    ]


def _points(text: str | None) -> list[str] | None:
    """The answer's points, or None when it holds nothing usable."""
    if not text:
        return None
    body = _THINK.sub("", text)
    at = body.find("{")
    while at >= 0:
        try:
            obj, _ = _DECODER.raw_decode(body, at)
        except ValueError:
            obj = None
        if isinstance(obj, dict) and isinstance(obj.get("points"), list):
            pts = [
                " ".join(p.split())[:MAX_POINT_CHARS]
                for p in obj["points"]
                if isinstance(p, str) and p.strip()
            ][:MAX_POINTS]
            return pts or None
        at = body.find("{", at + 1)
    return None


def ask(ctx: Ctx, resolved: ai.ResolvedModel, text: str) -> str | None:
    """The one model call: its answer text, or None when the provider
    fails. Metered either way (flushed, the caller commits)."""
    model = ai.build_chat_model(resolved)
    msgs: list[BaseMessage] = [SystemMessage(SYSTEM), HumanMessage(content=text)]
    try:
        out = model.invoke(msgs)
    except Exception:  # noqa: BLE001 - any provider failure is the page's error state
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


def _keep(ctx: Ctx, f: YesterdayFacts, points: list[str], model: str) -> None:
    row = owned_repo.find_one(
        ctx, MissAnalysis, col(MissAnalysis.day) == f.day, include_deleted=True
    )
    if row is None:
        savepoint = ctx.session.begin_nested()
        try:
            owned_repo.insert(
                ctx,
                MissAnalysis,
                {
                    "day": f.day,
                    "fingerprint": f.fingerprint,
                    "points": points,
                    "model": model,
                },
            )
        except IntegrityError:
            # Another open of the page kept its answer first; theirs stands.
            savepoint.rollback()
            return
        savepoint.commit()
        return
    row.fingerprint = f.fingerprint
    row.points = points
    row.model = model
    row.deleted_at = None
    row.updated_at = ctx.now
    ctx.session.add(row)
    ctx.session.flush()


def analyse_yesterday(ctx: Ctx) -> Analysis:
    f = facts(ctx)
    if not f.misses:
        return _result(f, "none", [])
    kept = owned_repo.find_one(ctx, MissAnalysis, col(MissAnalysis.day) == f.day)
    if kept is not None and kept.fingerprint == f.fingerprint and kept.points:
        return _result(f, "fern", list(kept.points))
    resolved = _model(ctx)
    if resolved is None:
        return _result(f, "rules", rules_points(f))
    data = {
        "yesterday": {"done": f.done, "due": f.due, "on_target": f.on_target},
        "missed_yesterday": [
            {k: v for k, v in m.items() if k != "id"} for m in f.misses
        ],
        "missed_earlier_this_week": [
            {k: v for k, v in m.items() if k != "id"} for m in f.week[:40]
        ],
    }
    answer = ask(
        ctx,
        resolved,
        PROMPT.format(day=f.day.isoformat(), data=json.dumps(data, ensure_ascii=False)),
    )
    points = _points(answer)
    if points is None:
        ctx.commit()  # the metered call stands even though the answer failed
        raise domain_error(
            503,
            "analysis_failed",
            "Fern could not read yesterday just now. Try again.",
        )
    _keep(ctx, f, points, resolved.model)
    ctx.commit()
    return _result(f, "fern", points)
