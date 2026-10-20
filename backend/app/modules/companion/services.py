"""The companion (Fern by default): ask, the conversation, trackers and memories.

``ask`` answers with the user's chat model when one resolves and the AI
switch and spend cap allow it (a LangGraph agent whose tools emit the companion's
render blocks and hand logs to capture); otherwise with the deterministic
router (:mod:`brain`). A message that is a log or a question about the data
becomes a capture, as in the prototype, where the chat shows captures in
line with the companion's messages.
"""

import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.capture import public as capture
from app.modules.companion import brain, grounding
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import Companion, CompanionMessage, Memory, Tracker
from app.modules.companion.schema import (
    AskOut,
    Insight,
    MessagePublic,
    Metric,
    SeriesOut,
    TrackerIn,
)
from app.modules.profile import public as profile
from app.modules.stats import public as stats
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

Emit = Callable[[str, dict[str, Any]], None]
# What one companion answer may cost. The model sees the last HISTORY messages,
# each cut to HISTORY_CHARS, and gets at most MAX_STEPS model calls (a tool
# round, then the answer, with one spare); tool results are cut in capture's
# loop (``agent.MAX_TOOL_RESULT_CHARS``).
HISTORY = 6
HISTORY_CHARS = 600
MAX_STEPS = 3
MAX_MEMORIES_IN_CONTEXT = 50


def _noop(event: str, data: dict[str, Any]) -> None:
    del event, data


# ---------------------------------------------------------------- rows


def companion_row(ctx: Ctx) -> Companion:
    row = owned_repo.find_one(ctx, Companion, include_deleted=True)
    if row is None:
        row, _ = owned_repo.insert_once(
            ctx,
            Companion,
            {"name": COMPANION_NAME},
            row_id=derived_id("companion", ctx.user_id, "row"),
        )
    elif row.deleted_at is not None:
        owned_repo.restore(ctx, row)
    return row


def rename(ctx: Ctx, *, name: str) -> Companion:
    row = companion_row(ctx)
    row.name = name.strip() or COMPANION_NAME
    ctx.session.add(row)
    ctx.commit()
    return row


def trackers(ctx: Ctx) -> list[Tracker]:
    return owned_repo.list_rows(ctx, Tracker, order_by=[col(Tracker.created_at)])


def memories(ctx: Ctx) -> list[Memory]:
    return owned_repo.list_rows(ctx, Memory, order_by=[col(Memory.created_at)])


def upsert_tracker_row(ctx: Ctx, metric: str, data: dict[str, Any]) -> Tracker:
    """``addTracker``: one tracker per metric; a second one updates it (a
    removed tracker is revived). Flushes."""
    values = {
        "metric": metric,
        "label": data.get("label") or brain.metric_label(metric),
        "goal": data.get("goal"),
        "direction": data.get("direction") if data.get("goal") else None,
    }
    row, _ = owned_repo.upsert(
        ctx,
        Tracker,
        data.get("id") or derived_id("tracker", ctx.user_id, metric),
        values,
        natural_key=("metric",),
    )
    return row


def upsert_tracker(ctx: Ctx, *, metric: str, data: TrackerIn) -> Tracker:
    row = upsert_tracker_row(ctx, metric, data.model_dump(exclude_unset=True))
    ctx.commit()
    return row


def remove_tracker(ctx: Ctx, *, tracker_id: uuid.UUID) -> None:
    owned_repo.soft_delete(
        ctx, owned_repo.require(ctx, Tracker, tracker_id, what="tracker")
    )
    ctx.commit()


def remember_row(ctx: Ctx, text: str, memory_id: uuid.UUID | None = None) -> Memory:
    rid = memory_id or uuid.uuid4()
    existing = owned_repo.get(ctx, Memory, rid, include_deleted=True)
    if existing is not None and existing.deleted_at is None:
        return existing
    row, _ = owned_repo.upsert(ctx, Memory, rid, {"text": text.strip()[:500]})
    return row


def remember(ctx: Ctx, *, text: str, memory_id: uuid.UUID | None = None) -> Memory:
    row = remember_row(ctx, text, memory_id)
    ctx.commit()
    return row


def forget(ctx: Ctx, *, memory_id: uuid.UUID) -> None:
    owned_repo.soft_delete(
        ctx, owned_repo.require(ctx, Memory, memory_id, what="memory")
    )
    ctx.commit()


def messages(ctx: Ctx, *, skip: int, limit: int) -> tuple[list[CompanionMessage], int]:
    """The conversation, oldest first (the chat scrolls up for history)."""
    total = owned_repo.count_rows(ctx, CompanionMessage)
    rows = owned_repo.list_rows(
        ctx,
        CompanionMessage,
        order_by=[col(CompanionMessage.created_at), col(CompanionMessage.id)],
        skip=skip,
        limit=limit,
    )
    return rows, total


def clear_conversation(ctx: Ctx) -> int:
    rows = owned_repo.list_rows(ctx, CompanionMessage)
    for r in rows:
        owned_repo.soft_delete(ctx, r)
    ctx.commit()
    return len(rows)


def _message(
    ctx: Ctx,
    role: str,
    text: str | None,
    blocks: list[dict[str, Any]],
    row_id: uuid.UUID,
) -> CompanionMessage:
    return owned_repo.insert(
        ctx,
        CompanionMessage,
        {"role": role, "text": text, "blocks": blocks},
        row_id=row_id,
    )


def _pub(ctx: Ctx, m: CompanionMessage) -> MessagePublic:
    ctx.session.flush()
    ctx.session.refresh(m)
    return MessagePublic.model_validate(m)


# ---------------------------------------------------------------- ask


def _apply(ctx: Ctx, r: brain.Route) -> list[dict[str, Any]]:
    blocks = [dict(b) for b in r.blocks]
    if r.effect is not None and r.effect.kind == "remember" and r.effect.fact:
        remember_row(ctx, r.effect.fact)
    if r.effect is not None and r.effect.kind == "track" and r.effect.tracker:
        t = upsert_tracker_row(ctx, str(r.effect.tracker["metric"]), r.effect.tracker)
        for b in blocks:
            if b.get("t") == "tracker":
                b["id"] = str(t.id)
    return blocks


def _resolve(ctx: Ctx) -> ai.ResolvedModel | None:
    resolved = ai.resolve_model(ctx, "chat")
    if resolved is None:
        return None
    try:
        ai.check_budget(ctx)
    except HTTPException:
        # The companion falls back to the router when the AI is off or capped; a log it
        # hands to capture is refused there and kept as a failed capture.
        return None
    return resolved


def _to_capture(ctx: Ctx, text: str, me_id: uuid.UUID, emit: Emit) -> dict[str, Any]:
    cu = derived_id("companion-capture", me_id, "capture")
    try:
        cap = capture.submit_capture(ctx, client_uuid=cu, text=text, emit=emit)
        return capture.capture_detail(ctx, cap.id)
    except HTTPException as exc:
        detail: dict[str, Any] = exc.detail if isinstance(exc.detail, dict) else {}
        cid = (detail.get("details") or {}).get("capture_id")
        if cid:
            return capture.capture_detail(ctx, uuid.UUID(cid))
        raise


def ask(
    ctx: Ctx, *, text: str, message_id: uuid.UUID | None = None, emit: Emit = _noop
) -> AskOut:
    me_id = message_id or uuid.uuid4()
    sol_id = derived_id("companion-reply", me_id, "sol")
    existing = owned_repo.get(ctx, CompanionMessage, me_id, include_deleted=True)
    if existing is not None:
        reply = owned_repo.get(ctx, CompanionMessage, sol_id)
        msgs = [_pub(ctx, existing)] + ([_pub(ctx, reply)] if reply else [])
        return AskOut(kind="reply", engine="rules", messages=msgs)
    sol = companion_row(ctx)
    user_name = profile.get_profile(ctx).name
    resolved = _resolve(ctx)
    if resolved is not None:
        try:
            return _ask_ai(
                ctx, resolved, text, me_id, sol_id, sol.name, user_name, emit
            )
        except capture.SeamError:
            # The provider failed (metered as a failed call): the router
            # answers instead, reusing the question already stored.
            pass
    r = brain.route(text, user_name=user_name, sol_name=sol.name)
    if r.kind == "capture":
        stored = owned_repo.get(ctx, CompanionMessage, me_id)
        if stored is not None:
            # The AI path stored (and streamed) the question before its
            # provider failed; the capture carries it in the thread now. A
            # tombstone, not a hard delete, so a device that got it drops it.
            owned_repo.soft_delete(ctx, stored)
        cap = _to_capture(ctx, text, me_id, emit)
        ctx.commit()
        return AskOut(kind="capture", engine="rules", capture=cap)
    me = owned_repo.get(ctx, CompanionMessage, me_id) or _message(
        ctx, "me", text, [], me_id
    )
    emit("message", _pub(ctx, me).model_dump(mode="json"))
    blocks = _apply(ctx, r)
    for b in blocks:
        emit("block", b)
    out = _message(ctx, "sol", r.text, blocks, sol_id)
    ctx.commit()
    return AskOut(
        kind="reply", engine="rules", messages=[_pub(ctx, me), _pub(ctx, out)]
    )


# ---------------------------------------------------------------- AI


class ChartArgs(BaseModel):
    metric: Metric
    days: Annotated[int, Field(ge=7, le=365)] = 30


class CoachArgs(BaseModel):
    mood: Literal["low"] | None = None


class TrackArgs(BaseModel):
    metric: Metric
    goal: Annotated[float, Field(gt=0, le=1e12)] | None = None
    direction: Literal["below", "above"] | None = None


class RememberArgs(BaseModel):
    fact: Annotated[str, Field(min_length=1, max_length=500)]


class ForgetArgs(BaseModel):
    memory_id: uuid.UUID


class ChipsArgs(BaseModel):
    prompts: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        min_length=1, max_length=4
    )


class LogArgs(BaseModel):
    text: Annotated[str, Field(min_length=1, max_length=2000)] = Field(
        description="What to log, in the user's words"
    )


class LookupArgs(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=300)]


class OverviewArgs(BaseModel):
    days: Annotated[int, Field(ge=1, le=366)] = 30


class NoArgs(BaseModel):
    pass


@dataclass
class SolRun:
    ctx: Ctx
    me_id: uuid.UUID
    emit: Emit
    blocks: list[dict[str, Any]] = field(default_factory=list)
    captures: list[dict[str, Any]] = field(default_factory=list)

    def block(self, b: dict[str, Any]) -> dict[str, Any]:
        self.blocks.append(b)
        self.emit("block", b)
        return {"shown": b["t"]}


def sol_tools(run: SolRun) -> list[BaseTool]:
    ctx = run.ctx

    # Each block tool returns the facts its card shows, so the reply can talk
    # about the card without inventing it.
    def show_chart(**kw: Any) -> dict[str, Any]:
        a = ChartArgs(**kw)
        shown = run.block({"t": "chart", "metric": a.metric, "days": a.days})
        vals = [v for _, v in stats.series(ctx, metric=a.metric, days=a.days)]
        logged = [v for v in vals if v is not None]
        return {
            **shown,
            "days": a.days,
            "days_with_data": len(logged),
            "latest": logged[-1] if logged else None,
            "total": round(sum(logged), 2) if logged else None,
        }

    def show_insights(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        shown = run.block({"t": "insights"})
        return {**shown, "insights": [i.title for i in insights(ctx)]}

    def coach(**kw: Any) -> dict[str, Any]:
        a = CoachArgs(**kw)
        shown = run.block({"t": "coach", **({"mood": a.mood} if a.mood else {})})
        return {**shown, **grounding.scores(ctx)}

    def plan_day(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        shown = run.block({"t": "plan"})
        items = grounding.plan(ctx)
        return {**shown, "items": items, "nothing_pending": not items}

    def track(**kw: Any) -> dict[str, Any]:
        a = TrackArgs(**kw)
        t = upsert_tracker_row(
            ctx,
            a.metric,
            {"goal": a.goal, "direction": a.direction or ("below" if a.goal else None)},
        )
        return run.block({"t": "tracker", "id": str(t.id)})

    def remember_fact(**kw: Any) -> dict[str, Any]:
        a = RememberArgs(**kw)
        remember_row(ctx, a.fact)
        return run.block({"t": "memory"})

    def forget_fact(**kw: Any) -> dict[str, Any]:
        a = ForgetArgs(**kw)
        m = owned_repo.get(ctx, Memory, a.memory_id)
        if m is None:
            return {"error": "memory_not_found"}
        owned_repo.soft_delete(ctx, m)
        return run.block({"t": "memory"})

    def show_memories(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        return {**run.block({"t": "memory"}), "count": len(memories(ctx))}

    def suggest(**kw: Any) -> dict[str, Any]:
        a = ChipsArgs(**kw)
        return run.block({"t": "chips", "prompts": a.prompts})

    def log_to_capture(**kw: Any) -> dict[str, Any]:
        a = LogArgs(**kw)
        cap = _to_capture(
            ctx,
            a.text,
            derived_id("sol-log", run.me_id, str(len(run.captures))),
            run.emit,
        )
        run.captures.append(cap)
        run.emit("capture", cap)
        return {
            "capture_id": cap["id"],
            "status": cap["status"],
            "cards": [{"kind": c["kind"], "state": c["state"]} for c in cap["cards"]],
        }

    def lookup(**kw: Any) -> dict[str, Any]:
        a = LookupArgs(**kw)
        body = capture.answer_question(ctx, a.question)
        return {
            k: body.get(k)
            for k in ("title", "value", "sub", "basis", "body")
            if body.get(k)
        }

    def stats_overview(**kw: Any) -> dict[str, Any]:
        a = OverviewArgs(**kw)
        try:
            o = stats.overview(ctx, days=a.days)
        except NotImplementedError:
            return {"error": "stats_unavailable"}
        return {
            "life_score": o.life_score,
            "level": o.level,
            "delta": o.delta,
            "streak": o.streak,
            "best_streak": o.best_streak,
            "areas": [
                {"module": x.module, "rate": x.rate} for x in o.areas if x.enabled
            ],
        }

    specs: list[tuple[Callable[..., Any], type[BaseModel], str]] = [
        (show_chart, ChartArgs, "Show a chart of one metric over a number of days."),
        (show_insights, NoArgs, "Show the patterns card from the user's records."),
        (coach, CoachArgs, "Show the coach card (mood 'low' for a gentle check-in)."),
        (plan_day, NoArgs, "Show today's plan card."),
        (track, TrackArgs, "Track a metric, optionally against a goal."),
        (
            remember_fact,
            RememberArgs,
            "Remember a fact the user told you about themselves.",
        ),
        (forget_fact, ForgetArgs, "Forget one remembered fact by its id."),
        (show_memories, NoArgs, "Show what you remember about the user."),
        (suggest, ChipsArgs, "Offer up to four follow-up prompts as chips."),
        (
            log_to_capture,
            LogArgs,
            "Hand a log (spent, ate, did, weighed...) to capture.",
        ),
        (lookup, LookupArgs, "Look up a number in the user's own data."),
        (stats_overview, OverviewArgs, "The user's Life Score and area rates."),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=desc, args_schema=schema
        )
        for fn, schema, desc in specs
    ]


SYSTEM = """You are {sol}, the companion inside Personal SOP, a life-logging
app. The user is {user}. Today is {today}.

Voice: calm, plain, specific, like a steady friend who pays attention. One idea
per message, at most three short sentences in one paragraph. English, or Taglish if they write it.

Format: plain text only. No markdown: no asterisks, no headings, no bullet or
numbered lists, no tables. The cards you show carry any list.

Facts: every fact you state about the user (habits, tasks, streaks, scores,
money, training, food, plans, projects, people) must come from TODAY below, from
what you remember, or from a tool result in this conversation. Never invent
one, never guess a number, never assume a habit, project or goal. If something
is missing, say plainly that you don't have it yet and suggest logging it. Zero
or empty means none, so say so, never praise consistency you cannot see. Today's
due items are habits_due_today, tasks_due_today and fitness_due_today together;
say "Nothing is due today." only when all three are empty. The life score the
user sees on Today is life_score_7_days_shown_on_today.

Tools: show charts, insights, coaching, plans, trackers and memories with the
tools instead of describing them; each tool returns what its card shows, so
speak only to that and do not repeat the card. Hand anything the user did,
spent, ate or weighed to `log_to_capture`. Use `lookup` for a number not in
TODAY. Call each tool at most once.

TODAY (JSON, from the user's records; a missing key is unknown, not zero;
money is in pesos, written ₱):
{today_facts}

What you remember about the user (ids for forgetting):
{memories}

What you are tracking for them:
{trackers}"""

_MD = [
    (re.compile(r"\*\*(.+?)\*\*", re.S), r"\1"),
    (re.compile(r"__(.+?)__", re.S), r"\1"),
    (re.compile(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])"), r"\1"),
    (re.compile(r"`([^`]*)`"), r"\1"),
    (re.compile(r"^[ \t]{0,3}#{1,6}[ \t]+", re.M), ""),
    (re.compile(r"^[ \t]*(?:[-*+]|\d+[.)])[ \t]+", re.M), ""),
    (re.compile(r"[ \t]+$", re.M), ""),
    (re.compile(r"\n{3,}"), "\n\n"),
]


def plain_text(text: str) -> str:
    """The reply as plain text: the chat shows text as written, so markdown the
    model adds anyway (bold, headings, list markers) is removed, keeping the
    words and the line breaks."""
    for rx, sub in _MD:
        text = rx.sub(sub, text)
    return text.strip()


def _strip_marks(delta: str) -> str:
    """A streamed piece without emphasis marks; the stored reply goes through
    :func:`plain_text` and replaces the streamed one."""
    return delta.replace("*", "").replace("`", "")


def _history(ctx: Ctx) -> list[BaseMessage]:
    rows = owned_repo.list_rows(
        ctx,
        CompanionMessage,
        order_by=[col(CompanionMessage.created_at).desc()],
        limit=HISTORY,
    )
    out: list[BaseMessage] = []
    for m in reversed(rows):
        if not m.text:
            continue
        text = m.text[:HISTORY_CHARS]
        out.append(HumanMessage(text) if m.role == "me" else AIMessage(text))
    return out


def _ask_ai(
    ctx: Ctx,
    resolved: ai.ResolvedModel,
    text: str,
    me_id: uuid.UUID,
    sol_id: uuid.UUID,
    sol_name: str,
    user_name: str,
    emit: Emit,
) -> AskOut:
    mems = memories(ctx)[-MAX_MEMORIES_IN_CONTEXT:]
    system = SYSTEM.format(
        sol=sol_name,
        user=brain.first_name(user_name),
        today=ctx.today.isoformat(),
        today_facts=json.dumps(grounding.snapshot(ctx), ensure_ascii=False),
        memories="\n".join(f"- [{m.id}] {m.text}" for m in mems) or "(nothing yet)",
        trackers=json.dumps(
            [
                {
                    "metric": t.metric,
                    "label": t.label,
                    "goal": t.goal,
                    "direction": t.direction,
                }
                for t in trackers(ctx)
            ]
        ),
    )
    history = _history(ctx)
    me = _message(ctx, "me", text, [], me_id)
    emit("message", _pub(ctx, me).model_dump(mode="json"))
    run = SolRun(ctx=ctx, me_id=me_id, emit=emit)
    reply = capture.run_agent(
        ctx,
        resolved,
        system=system,
        messages=[*history, HumanMessage(text)],
        tools=sol_tools(run),
        on_text=lambda d: emit("text.delta", {"text": _strip_marks(d)}),
        max_turns=MAX_STEPS,
    )
    blocks = list(run.blocks)
    out = _message(ctx, "sol", plain_text(reply) or None, blocks, sol_id)
    ctx.commit()
    return AskOut(
        kind="reply",
        engine="ai",
        messages=[_pub(ctx, me), _pub(ctx, out)],
        capture=run.captures[-1] if run.captures else None,
    )


# ---------------------------------------------------------------- blocks data


def series(ctx: Ctx, *, metric: str, days: int) -> SeriesOut:
    """Chart block data, on ``stats.public.series``."""
    pts = stats.series(ctx, metric=metric, days=days)
    return SeriesOut(
        metric=metric,
        label=brain.metric_label(metric),
        days=days,
        points=[{"day": d, "value": v} for d, v in pts],  # type: ignore[misc]
    )


def _cap(s: str) -> str:
    return s[:1].upper() + s[1:]


def insights(ctx: Ctx) -> list[Insight]:
    """The insights block (``useInsights``) on ``stats.public.overview``:
    the Life Score trend, the strongest and softest area, today's progress
    and the on-target streak."""
    o = stats.overview(ctx, days=30)
    out: list[Insight] = []
    if o.life_score is not None and o.delta is not None:
        up = o.delta >= 0
        out.append(
            Insight(
                accent="good" if up else "warn",
                title=f"Life score {o.life_score} · {'up' if up else 'down'} {abs(o.delta)}",
                body="You're trending up versus the previous 30 days. Momentum is real — protect it."
                if up
                else "A dip versus the previous 30 days. Usually that's one area slipping, not everything.",
                track="life",
            )
        )
    rated = sorted(
        ((a.module, a.rate) for a in o.areas if a.enabled and a.rate is not None),
        key=lambda x: -(x[1] or 0),
    )
    if rated:
        (bk, bv), (wk, wv) = rated[0], rated[-1]
        out.append(
            Insight(
                accent="hab",
                title=f"{_cap(bk)} is carrying you ({round((bv or 0) * 100)}%)",
                body=f"{_cap(wk)} is your softest area at {round((wv or 0) * 100)}%. "
                "A small, daily win there moves your score the most.",
                track="spend" if wk == "finance" else wk,
            )
        )
    if o.today_due:
        out.append(
            Insight(
                accent="warn" if o.today_done < o.today_due else "good",
                title=f"{o.today_done} of {o.today_due} done today",
                body="One more small win keeps the day on target."
                if o.today_done < o.today_due
                else "Everything due today is done.",
                track="life",
            )
        )
    best = o.best_streak
    cur = o.streak
    out.append(
        Insight(
            accent="life",
            title=f"{cur}-day on-target streak",
            body=f"Your best is {best}. "
            + (
                "You're at your record — today extends it."
                if cur >= best and best > 0
                else f"{max(0, best - cur)} more days to match it."
            ),
            track="life",
        )
    )
    return out
