"""The companion (Fern by default): ask, the conversation, trackers and memories.

``ask`` answers with the user's chat model when one resolves and the AI
switch and spend cap allow it: one LangGraph agent that may take several
steps, with read tools, the companion's card tools and capture's write tools
bound directly, its progress streamed as AG-UI events (ADR-0015). Otherwise
the deterministic router (:mod:`brain`) answers. A message that is a log or a question about the data
becomes a capture, as in the prototype, where the chat shows captures in
line with the companion's messages.
"""

import json
import math
import re
import uuid
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement
from sqlmodel import col

from app.core.config import settings
from app.modules.ai_providers import public as ai
from app.modules.capture import public as capture
from app.modules.companion import (
    brain,
    grounding,
    intent,
    loop,
    memory,
    money_status,
    numbers,
    portions,
    records,
    redo,
    reintro,
    reply_format,
    web,
)
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import (
    MEMORY_KINDS,
    Companion,
    CompanionMessage,
    CompanionThread,
    Memory,
    Tracker,
)
from app.modules.companion.schema import (
    AskOut,
    Insight,
    MessagePublic,
    Metric,
    ReplyOut,
    SeriesOut,
    TrackerIn,
)
from app.modules.companion.turn import (
    NOTHING_WAITING,
    Step,
    TurnStream,
    kept_steps,
)
from app.modules.fitness import public as fitness
from app.modules.focus import public as focus
from app.modules.iam.deps import release_connection
from app.modules.profile import public as profile
from app.modules.stats import public as stats
from app.modules.tasks import public as tasks
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

Emit = Callable[[str, dict[str, Any]], None]
# What one companion answer may cost: at most MAX_STEPS model calls and
# MAX_TOOL_CALLS tool calls (enough to look something up, write several
# records and answer); tool results are cut in capture's loop
# (``agent.MAX_TOOL_RESULT_CHARS``).
#
# The turn sends the whole chat, word for word, newest first until
# ``history_budget`` is spent; what no longer fits slides into the chat's
# summary (``refresh_summary``), never cut mid-message. Was the last 12
# messages, each cut to 1,000 characters, with earlier days' replies left
# out: a long chat lost its start (Kai, 2026-11-02).
#
# Tokens are estimated, not counted: the models' tokenizers differ and are
# not all public. Measured on DeepSeek-V4-Flash (2026-11-02): English chat
# 3.4 characters a token, Taglish 3.1, JSON 3.0; 2.5 overestimates by 20-35%,
# so a budget is never overrun.
CHARS_PER_TOKEN = 2.5
# A message's role and separators.
MSG_OVERHEAD_TOKENS = 4
# Room a turn needs besides its history: the system prompt and tools
# (measured 14k tokens with 12 messages of history), tool results (up to
# MAX_TOOL_CALLS of agent.MAX_TOOL_RESULT_CHARS) and the reply.
TURN_RESERVE_TOKENS = 32_000
# Rows read to fill the budget; a chat longer than this sends its newest.
HISTORY_MAX_ROWS = 2_000
MAX_STEPS = loop.STEPS
# The reply when the person sent another message and asked for it at once
# ("Send now") before this one had any words. A reply that has words ends
# as it is: the old closing line ("Stopped here to get to your next
# message.") read as a rule leaking into the chat (Kai, 2026-11-01).
STOPPED = "(Paused for your next message.)"
MAX_TOOL_CALLS = 20
# Corrective passes a reply may get after its first (a claim no write backs,
# figures no tool returned, no words at all): each is a full model run.
MAX_FIX_PASSES = 2


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
    """The memories in force (replaced ones are history), oldest first."""
    return memory.live(ctx)


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
    """A memory from the app or the rules engine (no judge): kept unless the
    same text, or one close enough in meaning, is already known."""
    rid = memory_id or uuid.uuid4()
    existing = owned_repo.get(ctx, Memory, rid, include_deleted=True)
    if existing is not None and existing.deleted_at is None:
        return existing
    return memory.remember(ctx, text=text, memory_id=rid, source="app").memory


JUDGE = """You compare two statements a personal assistant keeps about
one person. OLD is already kept; NEW was just said. Answer JSON only:
{"verdict": "same" | "update" | "contradicts" | "different"}
- same: NEW says nothing OLD does not.
- update: NEW is a newer or fuller version of the same fact.
- contradicts: NEW says the opposite of OLD; NEW is now true.
- different: they are about different things."""


class _Verdict(BaseModel):
    verdict: Literal["same", "update", "contradicts", "different"]


def memory_judge(ctx: Ctx, resolved: ai.ResolvedModel) -> memory.Judge:
    """The chat model as the judge for a memory close to an old one; a
    failed call answers "different" (keep both rather than lose one)."""

    def judge(old: str, new: str) -> memory.Verdict:
        try:
            out = capture.ask_json(
                ctx, resolved, _Verdict, system=JUDGE, text=f"OLD: {old}\nNEW: {new}"
            )
        except capture.SeamError:
            return "different"
        return out.verdict  # type: ignore[no-any-return]

    return judge


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


# The chat a turn belongs to, set by `ask` for the whole turn: its messages
# are stored in it, and the history and summary the model sees are its own.
_THREAD: ContextVar[CompanionThread | None] = ContextVar(
    "companion_thread", default=None
)
THREAD_TITLE = 48


def thread_for(ctx: Ctx, thread_id: uuid.UUID | None) -> CompanionThread:
    """The chat a message goes to: the one named (made with that id when the
    phone started it offline, brought back if it was deleted), else the most
    recent, else a new one.

    A chat started on the phone is also pushed by sync, often in the same
    moment as its first question: the push can land between this lookup and
    the insert, so the insert takes the pushed row instead of failing."""
    if thread_id is not None:
        row = owned_repo.get(ctx, CompanionThread, thread_id, include_deleted=True)
        if row is None:
            row, _ = owned_repo.insert_once(ctx, CompanionThread, {}, row_id=thread_id)
        if row.deleted_at is not None:
            owned_repo.restore(ctx, row)
        return row
    latest = owned_repo.list_rows(
        ctx,
        CompanionThread,
        order_by=[col(CompanionThread.last_at).desc().nulls_last()],
        limit=1,
    )
    if latest:
        return latest[0]
    return owned_repo.insert(ctx, CompanionThread, {}, row_id=uuid.uuid4())


def delete_thread(ctx: Ctx, thread_id: uuid.UUID) -> None:
    """A deleted chat takes its messages with it (tombstones, so every device
    drops them)."""
    row = owned_repo.get(ctx, CompanionThread, thread_id)
    if row is None:
        return
    for m in owned_repo.list_rows(
        ctx, CompanionMessage, col(CompanionMessage.thread_id) == thread_id
    ):
        owned_repo.soft_delete(ctx, m)
    owned_repo.soft_delete(ctx, row)
    ctx.commit()


def _thread_where() -> list[ColumnElement[bool]]:
    t = _THREAD.get()
    return [col(CompanionMessage.thread_id) == t.id] if t is not None else []


# companion_message.text is varchar(8000). A model can write more than that
# (one did, over 8,000 characters, in a model comparison) and the insert then
# fails the whole turn, so the stored text is cut to fit instead.
MESSAGE_TEXT_MAX = 8000
CUT_MARK = "…"


def fit_message_text(text: str | None, limit: int = MESSAGE_TEXT_MAX) -> str | None:
    """``text`` unchanged when it fits; otherwise cut at the last whitespace
    that leaves room for a visible "…", so the person can see the reply
    was shortened. A run with no whitespace near the end is cut mid-word."""
    if text is None or len(text) <= limit:
        return text
    head = text[: limit - len(CUT_MARK)]
    cut = max(head.rfind(" "), head.rfind("\n"), head.rfind("\t"))
    # Only fall back to the word boundary when it keeps most of the reply.
    if cut > limit // 2:
        head = head[:cut]
    return head.rstrip() + CUT_MARK


def _message(
    ctx: Ctx,
    role: str,
    text: str | None,
    blocks: list[dict[str, Any]],
    row_id: uuid.UUID,
) -> CompanionMessage:
    text = fit_message_text(text)
    t = _THREAD.get()
    if t is not None:
        if t.title is None and role == "me" and text and text.strip():
            words = " ".join(text.split())
            t.title = (
                words
                if len(words) <= THREAD_TITLE
                else words[: THREAD_TITLE - 1].rsplit(" ", 1)[0] + "…"
            )
        t.last_at = ctx.now
        ctx.session.add(t)
    return owned_repo.insert(
        ctx,
        CompanionMessage,
        {
            "role": role,
            "text": text,
            "blocks": blocks,
            "thread_id": t.id if t is not None else None,
        },
        row_id=row_id,
    )


def speak_message(ctx: Ctx, message_id: uuid.UUID) -> bytes:
    """One of Fern's replies read aloud (MP3). Only a stored reply of the
    caller's can be spoken, never arbitrary text."""
    m = owned_repo.get(ctx, CompanionMessage, message_id)
    if m is None or m.role != "sol":
        raise HTTPException(status_code=404, detail="Message not found")
    text = (m.text or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail="That reply has no text")
    audio = capture.speak_text(ctx, text)
    ctx.commit()
    return audio


def _pub(ctx: Ctx, m: CompanionMessage) -> MessagePublic:
    ctx.session.flush()
    ctx.session.refresh(m)
    out = MessagePublic.model_validate(m)
    if any(b.get("t") == "photos" for b in out.blocks):
        out.blocks = [_with_urls(ctx, b) for b in out.blocks]
    return out


def _with_urls(ctx: Ctx, block: dict[str, Any]) -> dict[str, Any]:
    """A photos block with a fresh presigned link per photo (links expire,
    so they are signed when the message is read, never stored)."""
    if block.get("t") != "photos":
        return block
    from app.modules.media import public as media

    urls: list[str | None] = []
    for mid in block.get("media") or []:
        try:
            urls.append(
                media.download_url(media.require_ready(ctx, uuid.UUID(str(mid))))
            )
        except Exception:  # noqa: BLE001 - a deleted photo shows as missing
            urls.append(None)
    return {**block, "urls": urls}


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
    ctx: Ctx,
    *,
    text: str,
    message_id: uuid.UUID | None = None,
    stream: TurnStream | None = None,
    media_ids: list[uuid.UUID] | None = None,
    thread_id: uuid.UUID | None = None,
) -> AskOut:
    token = _THREAD.set(thread_for(ctx, thread_id))
    try:
        return _ask(
            ctx,
            text=text,
            message_id=message_id,
            stream=stream,
            media_ids=media_ids,
        )
    finally:
        _THREAD.reset(token)


def _ask(
    ctx: Ctx,
    *,
    text: str,
    message_id: uuid.UUID | None,
    stream: TurnStream | None,
    media_ids: list[uuid.UUID] | None,
) -> AskOut:
    me_id = message_id or uuid.uuid4()
    photos = list(dict.fromkeys(media_ids or []))
    if stream is None:
        stream = TurnStream(ctx, thread_id=str(ctx.user_id), run_id=str(me_id))
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
                ctx,
                resolved,
                text,
                me_id,
                sol_id,
                sol.name,
                user_name,
                stream,
                photos=photos,
            )
        except capture.SeamError:
            # The provider failed (metered as a failed call): the router
            # answers instead, reusing the question already stored.
            pass
    r = brain.route(text, user_name=user_name, sol_name=sol.name, currency=ctx.currency)
    if r.kind == "capture":
        stored = owned_repo.get(ctx, CompanionMessage, me_id)
        if stored is not None:
            # The AI path stored (and streamed) the question before its
            # provider failed; the capture carries it in the thread now. A
            # tombstone, not a hard delete, so a device that got it drops it.
            owned_repo.soft_delete(ctx, stored)
        cap = _to_capture(ctx, text, me_id, stream.frame)
        ctx.commit()
        return AskOut(kind="capture", engine="rules", capture=cap)
    me = owned_repo.get(ctx, CompanionMessage, me_id) or _message(
        ctx, "me", text, [], me_id
    )
    stream.custom("message", _pub(ctx, me).model_dump(mode="json"))
    blocks = _apply(ctx, r)
    stream.text(r.text or "")
    for b in blocks:
        stream.custom("block", b)
    out = _message(ctx, "sol", r.text, blocks, sol_id)
    ctx.commit()
    return AskOut(
        kind="reply", engine="rules", messages=[_pub(ctx, me), _pub(ctx, out)]
    )


def stored_reply(ctx: Ctx, message_id: uuid.UUID) -> ReplyOut | None:
    """The finished reply to the question ``message_id``, as stored: the
    question and Fern's reply, or the capture a log became. None while
    nothing finished is stored."""
    me = owned_repo.get(ctx, CompanionMessage, message_id, include_deleted=True)
    reply = owned_repo.get(
        ctx, CompanionMessage, derived_id("companion-reply", message_id, "sol")
    )
    if reply is not None:
        msgs = ([_pub(ctx, me)] if me is not None and me.deleted_at is None else []) + [
            _pub(ctx, reply)
        ]
        return ReplyOut(status="done", messages=msgs)
    cap = capture.detail_for_client(
        ctx, derived_id("companion-capture", message_id, "capture")
    )
    if cap is not None:
        return ReplyOut(status="done", capture=cap)
    return None


def question_stored(ctx: Ctx, message_id: uuid.UUID) -> bool:
    return (
        owned_repo.get(ctx, CompanionMessage, message_id, include_deleted=True)
        is not None
    )


# ---------------------------------------------------------------- AI


class ChartArgs(BaseModel):
    metric: Metric
    days: Annotated[int, Field(ge=7, le=365)] = 30


# Chart metrics whose daily values are amounts (money spent, workouts
# done); every other one is a level or a rate and is averaged, never summed.
SUMMABLE_METRICS = frozenset({"spend", "workouts"})


class PortionFoodIn(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)] = Field(
        description="The food in the person's words (fried tilapia, rice)."
    )
    kcal_per_100g: Annotated[float, Field(ge=0, le=950)] | None = None
    protein_per_100g: Annotated[float, Field(ge=0, le=100)] | None = None
    carbs_per_100g: Annotated[float, Field(ge=0, le=100)] | None = None
    fat_per_100g: Annotated[float, Field(ge=0, le=100)] | None = None
    from_person: bool = Field(
        default=False, description="True when the values came from the person."
    )
    grams: Annotated[float, Field(gt=0, le=2000)] | None = Field(
        default=None, description="Only when they said how much they eat of it."
    )
    role: Literal["protein", "carb", "side", "extra"] | None = Field(
        default=None,
        description="extra: a shake or powder added by the scoop only if "
        "protein falls short. Leave out to let the planner decide.",
    )
    serving_grams: Annotated[float, Field(gt=0, le=500)] | None = Field(
        default=None, description="One scoop or serving, for an extra."
    )


class PortionPlanArgs(BaseModel):
    foods: list[PortionFoodIn] = Field(min_length=1, max_length=8)
    kcal: Annotated[float, Field(gt=0, le=6000)] | None = Field(
        default=None, description="Only when they named a calorie target."
    )
    protein: Annotated[float, Field(gt=0, le=400)] | None = Field(
        default=None, description="Only when they named a protein target."
    )
    whole_day: bool = Field(
        default=False,
        description="True when this meal should cover everything left today "
        "(their last meal, or they say so).",
    )


class CompareArgs(BaseModel):
    area: Literal["meals", "workouts", "weight", "money", "habits", "tasks", "focus"]
    period: Literal["week", "month", "days"] = "week"
    days: Annotated[int, Field(ge=1, le=183)] = Field(
        default=7, description="With period 'days': the last N days vs the N before."
    )
    contains: Annotated[str, Field(min_length=1, max_length=60)] | None = None


class FindTasksArgs(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=120)] = Field(
        description="Words from the task's title or notes."
    )


class RedoArgs(BaseModel):
    what: Annotated[str, Field(max_length=120)] | None = Field(
        default=None, description="Words naming the entry, when they said."
    )


class CoachArgs(BaseModel):
    mood: Literal["low"] | None = None


class TrackArgs(BaseModel):
    metric: Metric
    goal: Annotated[float, Field(gt=0, le=1e12)] | None = None
    direction: Literal["below", "above"] | None = None


class RememberArgs(BaseModel):
    fact: Annotated[str, Field(min_length=1, max_length=500)] = Field(
        description="One durable thing about the person, as a short third-"
        "person statement ('Prefers answers as short bullet lists', 'Sister "
        "Ana lives in Cebu'). One fact per call."
    )
    kind: Literal[
        "response_style",
        "preference",
        "profile",
        "fact",
        "goal",
        "relationship",
        "health",
        "routine",
        "event",
    ] = Field(
        default="fact",
        description="response_style: how they want answers (length, format, "
        "language, tone). profile: who they are (name, pronouns, job, city, "
        "units). preference: likes and dislikes. relationship: people in "
        "their life. health, goal, routine, event: as named. fact: anything "
        "else.",
    )
    tags: list[Annotated[str, Field(max_length=30)]] = Field(
        default_factory=list, max_length=6, description="Short topic words."
    )
    importance: Annotated[int, Field(ge=1, le=5)] = Field(
        default=3, description="5: must never be forgotten; 1: trivia."
    )
    always_on: bool = Field(
        default=False,
        description="True for something every answer must respect (a hard "
        "constraint such as an allergy or 'never suggest alcohol'). "
        "response_style and profile are always on already.",
    )


class RecallArgs(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=300)] = Field(
        description="What you need to know about the person, in plain words."
    )
    kinds: list[str] = Field(
        default_factory=list, description="Only these kinds; empty for all."
    )


class ForgetArgs(BaseModel):
    memory_id: uuid.UUID


class ChipsArgs(BaseModel):
    prompts: list[Annotated[str, Field(min_length=1, max_length=80)]] = Field(
        min_length=1, max_length=4
    )


class LookupArgs(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=300)]


class RecordsArgs(BaseModel):
    area: Literal["meals", "workouts", "weight", "money", "habits", "tasks", "focus"]
    first_day: date | None = Field(
        default=None, description="First day (YYYY-MM-DD); else `days` back."
    )
    last_day: date | None = Field(
        default=None, description="Last day (YYYY-MM-DD); default today."
    )
    days: Annotated[int, Field(ge=1, le=366)] = Field(
        default=7, description="How many days up to last_day, when no first_day."
    )
    group_by: Literal[
        "none", "day", "week", "month", "weekday",
        "meal", "food", "workout", "exercise", "type", "category", "payee",
        "account", "habit", "status", "task", "list", "item",
    ] = Field(
        default="day",
        description="'none' lists the records themselves (newest first).",
    )  # fmt: skip
    contains: Annotated[str, Field(min_length=1, max_length=60)] | None = Field(
        default=None,
        description="Only records whose text (food, category, payee, habit, "
        "task, exercise...) contains this.",
    )


class WebSearchArgs(BaseModel):
    query: Annotated[str, Field(min_length=2, max_length=200)]


class OverviewArgs(BaseModel):
    days: Annotated[int, Field(ge=1, le=366)] = 30


class DiscardArgs(BaseModel):
    what: str | None = Field(
        default=None,
        description="Words naming the one waiting entry to drop (its food or "
        "title); leave out to drop every waiting entry.",
    )


class NoArgs(BaseModel):
    pass


class FocusStatusArgs(BaseModel):
    days: Annotated[int, Field(ge=1, le=90)] = 1


class StartFocusArgs(BaseModel):
    mode: Literal["pomodoro", "stopwatch"] | None = None
    preset: Literal["25-5", "50-10", "90-20"] | None = None
    focus_min: Annotated[int, Field(ge=1, le=240)] | None = None
    item: Annotated[str, Field(max_length=160)] | None = None


class FocusControlArgs(BaseModel):
    action: Literal["pause", "resume", "skip_break", "next", "switch", "extend"]
    item: Annotated[str, Field(max_length=160)] | None = None
    minutes: Annotated[int, Field(ge=1, le=60)] = 5


class StopFocusArgs(BaseModel):
    abandon: bool = False


@dataclass
class SolRun:
    ctx: Ctx
    me_id: uuid.UUID
    emit: Emit
    blocks: list[dict[str, Any]] = field(default_factory=list)
    # What the person said this turn (with any photo reading).
    said: str = ""
    # Decides whether a new memory close to an old one is the same, an
    # update, a contradiction or different (the chat model; None: no judge).
    judge: memory.Judge | None = None
    # What `recall_memories` found this turn: it runs once a turn, so a model
    # that keeps searching (an empty result invites another try) gets the
    # same answer back and is told to reply instead of looping to the step cap.
    recalled: list[dict[str, Any]] | None = None
    # The capture this turn's own writes sit on, once one has written:
    # confirming or discarding what waits never touches it.
    turn_capture: Callable[[], uuid.UUID | None] = lambda: None
    # Every tool result of the turn, in order, for the number check.
    results: list[tuple[str, Any]] = field(default_factory=list)
    # The web searches the turn made, with their results (``same_search``).
    searches: list[dict[str, Any]] = field(default_factory=list)

    def block(self, b: dict[str, Any]) -> dict[str, Any]:
        self.blocks.append(b)
        self.emit("block", b)
        return {"shown": b["t"]}


_CONFIRM_WORD = re.compile(r"\b(confirm(ed)?|approve[ds]?)\b", re.I)
_CONFIRM_SHORT = re.compile(
    r"^\W*(yes|yeah|yep|yup|ok(ay)?|sure|go( ahead)?|save( it| them| both| all)?|"
    r"do it|add it|log it|record it|continue|proceed|sige|oo|opo|g|tama)\b",
    re.I,
)


def said_confirm(said: str) -> bool:
    """Whether the person's latest message tells Fern to save what is
    waiting: it says confirm (or approve) anywhere, or it is a short yes."""
    text = said.split("\n[", 1)[0].strip()  # without any photo reading
    return bool(_CONFIRM_WORD.search(text)) or (
        len(text) <= 60 and bool(_CONFIRM_SHORT.search(text))
    )


# Words a search may add to what the person said.
SEARCH_WORDS = frozenset(
    "nutrition nutritional calories calorie kcal macros macro protein carbs "
    "fat fiber sugar sodium facts per serving piece cup grams g price".split()
)


def own_words(query: str, said: str) -> str:
    """The search query kept to the person's own words plus a few search
    words: seen live, "Classic Savory chicken" was searched as a "chicken
    sandwich" the person never said. Falls back to the model's query when
    the person's words share nothing with it."""
    theirs = {w.lower() for w in re.findall(r"[\w'-]+", said)}
    kept = [
        w
        for w in query.split()
        if not re.fullmatch(r"[A-Za-z][\w'-]*", w)
        or w.lower() in theirs
        or w.lower() in SEARCH_WORDS
    ]
    return " ".join(kept) if len(kept) >= 2 else query


def with_day_after(ctx: Ctx, tool: BaseTool) -> BaseTool:
    """``log_meal`` that also returns the day's totals once this meal is in,
    computed here, so the reply never adds numbers up itself. A meal waiting
    for the user's OK is not in the records yet, so its items are added."""
    inner = tool.func  # type: ignore[attr-defined]

    def log_meal(**kw: Any) -> Any:
        res = inner(**kw)
        if not isinstance(res, dict) or res.get("error"):
            return res
        day = fitness.nutrition_today(ctx)
        eaten = dict(day.get("eaten") or {})
        waiting = res.get("state") in ("proposed", "needs_input")
        items = kw.get("items") or []
        if waiting and items:
            for it in items:
                for k in ("kcal", "protein", "carbs", "fat"):
                    v = it.get(k) if isinstance(it, dict) else getattr(it, k, 0)
                    eaten[k] = round(eaten.get(k, 0) + float(v or 0), 1)
        out: dict[str, Any] = {"eaten_today_with_this_meal": eaten}
        if items:
            # The meal's own total, so "lunch, 650 kcal" is a figure a tool
            # returned (the number check) rather than the model's sum.
            out["this_meal"] = {
                k: round(
                    sum(
                        float(
                            (it.get(k) if isinstance(it, dict) else getattr(it, k, 0))
                            or 0
                        )
                        for it in items
                    ),
                    1,
                )
                for k in ("kcal", "protein", "carbs", "fat")
            }
        if "target" in day:
            out["left_today"] = {
                k: round(v - eaten.get(k, 0), 1) for k, v in day["target"].items()
            }
        if waiting and not items:
            out["note"] = "this meal is not counted until they confirm it"
        # The meals still ahead after this one, and what each can take, for
        # the suggestions that follow a logged meal. A meal still waiting is
        # not in the records yet, so the meal it is (the first still ahead)
        # comes off the list here.
        ahead = list(day.get("meals_ahead") or [])
        if waiting and ahead:
            ahead = ahead[1:]
        out["meals_ahead"] = ahead
        if "limits_left" in day:
            out["limits_left"] = day["limits_left"]
        if ahead and "left_today" in out:
            n = len(ahead)
            macros = ("kcal", "protein", "carbs", "fat")
            out["per_meal_ahead"] = {
                k: round(max(float(out["left_today"].get(k, 0)), 0) / n, 1)
                for k in macros
            } | {
                k: round(max(float(v), 0) / n, 1)
                for k, v in (day.get("limits_left") or {}).items()
            }
        if day.get("recent_foods"):
            out["recent_foods"] = day["recent_foods"]
        return {**res, "day_after_this_meal": out}

    return StructuredTool.from_function(
        func=log_meal,
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_schema,
    )


WEB_SEARCHES = 5
# Words every nutrition search carries; two searches for the same food differ
# only in these, so they are left out when searches are compared.
_SEARCH_FILLER = frozenset(
    "nutrition nutritional facts fact information info label calories calorie "
    "kcal protein carbs carbohydrates fat fats sugar sodium fiber per serving "
    "servings size philippines ph the of a and in for with vs how many much "
    "100g 100 g ml grams values value macros macro".split()
)
SAME_SEARCH = 0.6


def _search_words(query: str) -> set[str]:
    return {
        w for w in re.findall(r"[a-z0-9]+", query.lower()) if w not in _SEARCH_FILLER
    }


def same_search(query: str, earlier: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The earlier search ``query`` repeats in other words: the same food
    words (Jaccard at least SAME_SEARCH once the nutrition words are left
    out), or every word of a two-word-or-longer earlier query."""
    words = _search_words(query)
    if not words:
        return None
    for e in earlier:
        before = _search_words(str(e["query"]))
        if not before or not e.get("results"):
            continue
        overlap = len(words & before) / len(words | before)
        if overlap >= SAME_SEARCH or (len(before) >= 2 and before <= words):
            return e
    return None


def recording(run: SolRun, tool: BaseTool) -> BaseTool:
    """``tool`` that also keeps its result on the run, so the reply's
    numbers can be checked against what the tools returned."""
    inner = tool.func  # type: ignore[attr-defined]

    def call(**kw: Any) -> Any:
        res = inner(**kw)
        run.results.append((tool.name, res))
        return res

    return StructuredTool.from_function(
        func=call,
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_schema,
    )


def without_duplicate_tasks(ctx: Ctx, tool: BaseTool) -> BaseTool:
    """``create_tasks`` that refuses a task already open under the same
    title. Seen live: "yes log it to note and push it tomorrow" made a
    second copy of the task instead of editing the first."""
    inner = tool.func  # type: ignore[attr-defined]

    def create_tasks(**kw: Any) -> Any:
        dupes = []
        for t in kw.get("tasks") or []:
            title = str(t.get("title") if isinstance(t, dict) else t.title).strip()
            for hit in tasks.find_open_tasks(ctx, title, limit=5):
                if hit.title.strip().casefold() == title.casefold():
                    dupes.append(
                        {
                            "title": hit.title,
                            "due_date": hit.due_date.isoformat()
                            if hit.due_date
                            else None,
                        }
                    )
                    break
        if dupes:
            return {
                "error": "already_open",
                "existing": dupes,
                "instead": "change the existing task with edit_task (notes, "
                "due_date); call create_tasks again only for tasks that are new",
            }
        return inner(**kw)

    return StructuredTool.from_function(
        func=create_tasks,
        name=tool.name,
        description=tool.description,
        args_schema=tool.args_schema,
    )


def _library_food(
    ctx: Ctx, name: str
) -> tuple[str, dict[str, float], float | None] | None:
    """A food from the person's library whose words match ``name`` either
    way, with its values per 100 g (a per-piece food needs its weight)."""
    want = set(re.findall(r"[a-z]+", name.lower()))
    for f in fitness.food_library.search_foods(ctx, name, limit=5):
        have = set(re.findall(r"[a-z]+", f.name.lower()))
        if not have or not (have <= want or want <= have):
            continue
        if f.basis == "100g":
            scale = 1.0
        elif f.unit_grams:
            scale = 100 / f.unit_grams
        else:
            continue
        per100 = {k: float(getattr(f, k) or 0) * scale for k in portions.MACROS}
        return f.name, per100, f.unit_grams if f.basis != "100g" else None
    return None


# Asking to bring back what they undid: "redo", "save it again", "undo the
# undo", "re-confirm". A plain "confirm" passes too (said_confirm).
_REDO_WORDS = re.compile(
    r"\b(redo|re-?confirm|re-?save|save (?:it|that|them) again|undo (?:the|my) "
    r"undo|bring (?:it|that) back|restore|put (?:it|that) back|ibalik)\b",
    re.I,
)


def sol_tools(run: SolRun) -> list[BaseTool]:
    ctx = run.ctx

    # Each block tool returns the facts its card shows, so the reply can talk
    # about the card without inventing it.
    def show_chart(**kw: Any) -> dict[str, Any]:
        a = ChartArgs(**kw)
        shown = run.block({"t": "chart", "metric": a.metric, "days": a.days})
        try:
            vals = [v for _, v in stats.series(ctx, metric=a.metric, days=a.days)]
        except ValueError:
            # spendCats is slices, not days: the card draws it, no numbers.
            return {**shown, "days": a.days}
        logged = [v for v in vals if v is not None]
        out: dict[str, Any] = {
            **shown,
            "days": a.days,
            "days_with_data": len(logged),
            "latest": logged[-1] if logged else None,
        }
        if logged:
            out |= {
                "average": round(sum(logged) / len(logged), 2),
                "min": min(logged),
                "max": max(logged),
            }
            # Only amounts add up: a month of weights or scores has no total
            # (it was returned for every metric, and said as "your total").
            if a.metric in SUMMABLE_METRICS:
                out["total"] = round(sum(logged), 2)
        return out

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
        saved = memory.remember(
            ctx,
            text=a.fact,
            kind=a.kind,
            tags=a.tags,
            importance=a.importance,
            always_on=a.always_on,
            # "said" only when the person asked for it to be kept; Fern
            # saving on its own (mid-reply, or in `learn`) is "inferred".
            source="said" if _ASKS_TO_REMEMBER.search(run.said or "") else "inferred",
            judge=run.judge,
        )
        out: dict[str, Any] = {
            "status": saved.status,
            "memory_id": str(saved.memory.id),
        }
        if saved.status == "duplicate":
            out["already_known"] = saved.memory.text
        if saved.replaced is not None:
            out["replaced"] = saved.replaced.text
        if saved.status != "duplicate":
            out |= run.block({"t": "memory"})
        return out

    def recall_memories(**kw: Any) -> dict[str, Any]:
        a = RecallArgs(**kw)
        if run.recalled is not None:
            return {
                "memories": run.recalled,
                "repeat": True,
                "note": "Memories were already recalled this turn; this is "
                "everything known. Answer now with what you have.",
            }
        kinds = [k for k in a.kinds if k in MEMORY_KINDS] or None
        found = memory.recall(ctx, a.query, kinds=kinds)
        run.recalled = [
            {
                "id": str(m.id),
                "text": m.text,
                "kind": m.kind,
                "tags": m.tags,
                "since": ctx.clock.day_of(m.created_at).isoformat(),
            }
            for m in found
        ]
        return {"memories": run.recalled}

    def reread_photos(**kw: Any) -> dict[str, Any]:
        """The latest photos in this chat, read again slowly (a label the
        first reading got wrong)."""
        NoArgs(**kw)
        latest = next(
            (
                (m, b)
                for m in owned_repo.list_rows(
                    ctx,
                    CompanionMessage,
                    col(CompanionMessage.role) == "me",
                    *_thread_where(),
                    order_by=[col(CompanionMessage.created_at).desc()],
                    limit=20,
                )
                for b in m.blocks or []
                if b.get("t") == "photos" and b.get("media")
            ),
            None,
        )
        if latest is None:
            return {"error": "no_photos_in_this_chat"}
        m, block = latest
        media = block["media"]
        ids = [uuid.UUID(str(x)) for x in media] if isinstance(media, list) else []
        seen, read = capture.describe_photos(ctx, ids, m.text or "", careful=True)
        if not read:
            return {"error": "photos_could_not_be_read", "detail": seen}
        m.blocks = [
            {**b, "read": seen[:PHOTO_READ_CHARS]} if b is block else b
            for b in m.blocks
        ]
        ctx.session.add(m)
        ctx.session.flush()
        return {"photos": len(read), "read": seen}

    def forget_fact(**kw: Any) -> dict[str, Any]:
        a = ForgetArgs(**kw)
        m = owned_repo.get(ctx, Memory, a.memory_id)
        if m is None:
            return {"error": "memory_not_found"}
        owned_repo.soft_delete(ctx, m)
        return run.block({"t": "memory"})

    def show_memories(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        return {**run.block({"t": "memory"}), "count": len(memory.live(ctx))}

    def suggest(**kw: Any) -> dict[str, Any]:
        a = ChipsArgs(**kw)
        return run.block({"t": "chips", "prompts": a.prompts})

    def lookup(**kw: Any) -> dict[str, Any]:
        a = LookupArgs(**kw)
        body = capture.answer_question(ctx, a.question)
        return {
            k: body.get(k)
            for k in ("title", "value", "sub", "basis", "body")
            if body.get(k)
        }

    def query_records(**kw: Any) -> dict[str, Any]:
        a = RecordsArgs(**kw)
        last = a.last_day or ctx.today
        first = a.first_day or last - timedelta(days=a.days - 1)
        return records.query(
            ctx,
            area=a.area,
            first=first,
            last=last,
            group_by=a.group_by,
            contains=a.contains,
        )

    def nutrition_status(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        # The person sees the day as a card (rings for the goals, bars for
        # the limits), once per reply however often the model asks.
        if not any(b["t"] == "nutrition" for b in run.blocks):
            run.block({"t": "nutrition", "day": ctx.today.isoformat()})
        # Fresh from the records, so a meal logged earlier in this turn
        # counts; a meal waiting for the user's OK does not, yet.
        return fitness.nutrition_today(ctx)

    def focus_status(**kw: Any) -> dict[str, Any]:
        a = FocusStatusArgs(**kw)
        return focus.summary(ctx, days=a.days)

    def start_focus(**kw: Any) -> dict[str, Any]:
        a = StartFocusArgs(**kw)
        return focus.start(
            ctx, mode=a.mode, preset=a.preset, focus_min=a.focus_min, item=a.item
        )

    def focus_control(**kw: Any) -> dict[str, Any]:
        a = FocusControlArgs(**kw)
        return focus.control(ctx, action=a.action, item=a.item, minutes=a.minutes)

    def stop_focus(**kw: Any) -> dict[str, Any]:
        a = StopFocusArgs(**kw)
        return focus.stop(ctx, abandon=a.abandon)

    def web_search(**kw: Any) -> dict[str, Any]:
        a = WebSearchArgs(**kw)
        query = own_words(a.query, run.said)
        # The same food asked again in other words gets the first answer
        # (seen live: one oat latte searched seven ways in two replies),
        # and a reply searches at most WEB_SEARCHES times.
        again = same_search(query, run.searches)
        if again is not None:
            return {
                "query": query,
                "same_as": again["query"],
                "results": again["results"],
                "next": "you searched this already in this reply; use "
                "these results, or estimate and say so",
            }
        if len(run.searches) >= WEB_SEARCHES:
            return {
                "error": "search_limit_reached",
                "instead": "stop searching: use the results above, or "
                "estimate and say it is an estimate",
            }
        # A network wait: give the connection back first (see run_loop).
        if not ctx.in_batch and not ctx.session.in_nested_transaction():
            release_connection(ctx.session)
        try:
            out = {"query": query, "results": web.search(query)}
        except web.WebSearchError as exc:
            return {"error": exc.code}
        run.searches.append(out)
        return out

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

    def confirm_pending(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        if not said_confirm(run.said):
            # Seen live: asked to log lunch, Fern confirmed everything
            # waiting, and a stale breakfast was saved.
            return {
                "error": "they_did_not_confirm",
                "instead": "ask whether to save what is waiting; they can say "
                "confirm or tap Confirm",
            }
        return capture.settle_waiting(
            ctx, action="confirm", keep_capture=run.turn_capture()
        )

    def discard_pending(**kw: Any) -> dict[str, Any]:
        a = DiscardArgs(**kw)
        return capture.settle_waiting(
            ctx, action="discard", keep_capture=run.turn_capture(), matching=a.what
        )

    def portion_plan(**kw: Any) -> dict[str, Any]:
        a = PortionPlanArgs(**kw)
        foods, unknown = portions.resolve(
            [f.model_dump(exclude_none=True) for f in a.foods],
            lambda name: _library_food(ctx, name),
        )
        if unknown:
            return {
                "error": "need_values_per_100g",
                "foods": unknown,
                "instead": "call again with kcal_per_100g and protein_per_100g "
                "(carbs, fat too) estimated for these foods",
            }
        day = fitness.nutrition_today(ctx)
        left = day.get("left")
        if a.kcal is None and a.protein is None and not left:
            return {
                "error": "no_macro_target",
                "instead": "ask their calorie and protein target for this meal",
            }
        share = 1 if a.whole_day else max(1, len(day.get("meals_ahead") or []))
        budget = {
            "kcal": a.kcal
            if a.kcal is not None
            else max(0.0, float((left or {}).get("kcal", 0))) / share,
            "protein": a.protein
            if a.protein is not None
            else max(0.0, float((left or {}).get("protein", 0))) / share,
        }
        out = portions.result(
            portions.plan(foods, budget),
            budget=budget,
            left_before={k: float(v) for k, v in left.items()} if left else None,
        )
        if share > 1:
            out["budget_is"] = f"what is left today shared by {share} meals ahead"
        run.block(portions.table(out))
        return {
            **out,
            "shown": "table",
            "note": "a plan, not a log; the table shows every number, so lead "
            "with the totals and what is left in one or two lines",
        }

    def compare_periods(**kw: Any) -> dict[str, Any]:
        a = CompareArgs(**kw)
        return records.compare(
            ctx, area=a.area, period=a.period, days=a.days, contains=a.contains
        )

    def finance_status(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        return money_status.status(ctx)

    def find_tasks(**kw: Any) -> dict[str, Any]:
        a = FindTasksArgs(**kw)
        hits = tasks.find_open_tasks(ctx, a.query, limit=8)
        return {
            "tasks": [
                {
                    "title": t.title,
                    "due_date": t.due_date.isoformat() if t.due_date else None,
                    "notes": t.notes or None,
                }
                for t in hits
            ]
        }

    def redo_undone(**kw: Any) -> dict[str, Any]:
        a = RedoArgs(**kw)
        if not (said_confirm(run.said) or _REDO_WORDS.search(run.said)):
            return {
                "error": "they_did_not_ask",
                "instead": "ask whether to save the undone entry again",
            }
        return redo.redo_undone(ctx, what=a.what)

    specs: list[tuple[Callable[..., Any], type[BaseModel], str]] = [
        (show_chart, ChartArgs, "Show a chart of one metric over a number of days."),
        (show_insights, NoArgs, "Show the patterns card from the user's records."),
        (coach, CoachArgs, "Show the coach card (mood 'low' for a gentle check-in)."),
        (plan_day, NoArgs, "Show today's plan card."),
        (track, TrackArgs, "Track a metric, optionally against a goal."),
        (
            remember_fact,
            RememberArgs,
            "Keep something durable about the person for later: a preference, "
            "how they like answers, who they are, people in their life, "
            "health, goals, routines. Repeats are recognised and not stored "
            "twice; a changed fact replaces the old one.",
        ),
        (
            recall_memories,
            RecallArgs,
            "Look up what you know about the person beyond ABOUT THEM: their "
            "likes, people, health, plans, past events. Call it before "
            "answering anything personal you are unsure of.",
        ),
        (
            reread_photos,
            NoArgs,
            "Read this chat's last photos again, digit by digit (when they "
            "ask to re-check a photo or label).",
        ),
        (forget_fact, ForgetArgs, "Forget one remembered fact by its id."),
        (show_memories, NoArgs, "Show what you remember about the user."),
        (suggest, ChipsArgs, "Offer up to four follow-up prompts as chips."),
        (lookup, LookupArgs, "Look up a number in the user's own data."),
        (
            query_records,
            RecordsArgs,
            "Read the user's own records in one area (meals, workouts, weight, "
            "money, habits, tasks, focus) over any days, filtered and grouped, "
            "with totals and per-day averages already worked out. Use it for "
            "any question about their past, comparisons and patterns.",
        ),
        (
            nutrition_status,
            NoArgs,
            "Today's food against the macro target: eaten (calories, protein, "
            "carbs, fat, fiber, saturated fat, sugar, sodium), target, what is "
            "left, meals logged, latest weigh-in. Call it for any question "
            "about macros, calories or what is left, and after logging a meal.",
        ),
        (
            focus_status,
            FocusStatusArgs,
            "How much the user focused (the focus timer) today, or over the "
            "last N days: the total against their daily focus goal, time by "
            "task or habit, the goal streak, and the session running now.",
        ),
        (
            start_focus,
            StartFocusArgs,
            "Start the focus timer now: a Pomodoro (preset 25-5, 50-10 or "
            "90-20, or focus_min) or a free stopwatch, optionally on a task or "
            "habit named in `item`. A session already running ends first.",
        ),
        (
            focus_control,
            FocusControlArgs,
            "Change the running focus session: pause, resume, skip_break, "
            "next (start the break or set it is waiting on), switch to "
            "another task or habit (`item`; none to clear), or extend by "
            "`minutes`.",
        ),
        (
            stop_focus,
            StopFocusArgs,
            "End the running focus session, keeping its time; abandon=true "
            "throws the session away so it counts nowhere.",
        ),
        (
            web_search,
            WebSearchArgs,
            "Search the web for facts outside the user's records: what a dish, "
            "food or product is and its nutrition (calories, protein, carbs, "
            "fat, fiber, sugar, sodium), prices, places. Returns titles, links "
            "and snippets.",
        ),
        (stats_overview, OverviewArgs, "The user's Life Score and area rates."),
        (
            confirm_pending,
            NoArgs,
            "Save every entry from recent chat turns that is waiting for the "
            "user's OK, when they say confirm, yes, save it, go ahead. Returns "
            "what was saved and what could not be (with why).",
        ),
        (
            discard_pending,
            DiscardArgs,
            "Drop entries from recent chat turns that are waiting for the "
            "user's OK: every one when they say cancel, no, don't save it; "
            "with `what`, only the entry those words name (to correct it).",
        ),
        (
            portion_plan,
            PortionPlanArgs,
            "Work out how many grams of each food to eat (a plate, a meal "
            "they plan) to fit what is left today: returns grams, kcal, "
            "protein, carbs and fat per food, the meal total and what is left "
            "after, all computed, and shows them as a table. Use it for any "
            "portion or 'how much should I eat' question. Give values per "
            "100 g for foods you estimate; the library and standard values "
            "fill the rest.",
        ),
        (
            compare_periods,
            CompareArgs,
            "Compare this week, this month or the last N days with the period "
            "before, in one area: per-day averages, the change and the "
            "percent change, computed; for meals also against the daily "
            "target.",
        ),
        (
            finance_status,
            NoArgs,
            "Where their money stands now: each account's balance, net worth, "
            "spent this month so far, every budget (spent, left, safe per "
            "day, on pace or not) and bills overdue or due in the next 7 days.",
        ),
        (
            find_tasks,
            FindTasksArgs,
            "Find open tasks by words in their title or notes, with due date "
            "and notes: before changing a task, or to answer about one.",
        ),
        (
            redo_undone,
            RedoArgs,
            "Save again an entry they Undid (redo it), when they ask to "
            "confirm, restore or redo something they undid.",
        ),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=desc, args_schema=schema
        )
        for fn, schema, desc in specs
    ]


# Kai, build 25: a photo meal waited as "black rice snack"; "it is ube"
# failed twice, because the rules said never to record a waiting entry
# again and no tool could change one, so the model claimed a fix it could
# not make. A correction drops that one entry and records it again.
CORRECT_WAITING = (
    "when they correct an entry still waiting (another food, name or amount: "
    '"it is ube"), call `discard_pending` with `what` naming that entry, then '
    "record it again, corrected, with the tool that made it, in this reply."
)
# The workflow and the few rules the tools cannot carry (loop.py).
SYSTEM = loop.WORKFLOW

# What changes every turn goes after the rules, so the rules and the tools
# stay one prefix a provider can cache across turns and days.
CONTEXT = """
NOW: {now_line}

TODAY (JSON, from the user's records; a missing key is unknown, not zero;
money is in {currency}):
{today_facts}

ABOUT THEM (always respect; ids for forgetting):
{memories}

What you are tracking for them:
{trackers}

{earlier}
{summary}
{turn}"""


# Said only when the person has switched a module off (``modules_off`` in
# TODAY). The app adds its own line under a write into one, with a button.
MODULES_OFF = (
    "`modules_off` are switched off in Settings: leave them out of summaries, "
    "plans and suggestions unless they ask about one by name. Still log what "
    "they tell you for one; the app notes under the reply that it won't show "
    "on Today, so don't say it yourself."
)


def _day_name(d: date) -> str:
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"


def now_line(ctx: Ctx) -> str:
    """Their day as their Today screen shows it, named the way they say it.

    Between midnight and the day's start hour the open day is still the
    previous date, on the phone and here. Handed both dates in ISO, the model
    wrote "On 2026-11-01 (your records haven't rolled over…)". It now gets the
    open day by name and is told to call it today. The ISO dates stay, for
    tool arguments: told only the business day, it once filed "tonight at
    9pm" on the day before."""
    local = ctx.now.astimezone(ctx.clock.zone)
    today = ctx.today
    clock = f"it is {local:%A %Y-%m-%d %H:%M} where they live"
    rolls = f"their day rolls over at {ctx.clock.start_hour:02d}:00"
    if today == local.date():
        said = f"today is {_day_name(today)} ({today.isoformat()}); {clock}; {rolls}."
    else:
        said = (
            f"{clock}, before {rolls}, so {_day_name(today)} ({today.isoformat()}) "
            "is still open: it is the day TODAY below and their Today screen show, "
            "and what they mean by today."
        )
    return (
        f'{said} In replies call it today and name any day by weekday and date ("'
        f'{_day_name(today)}"), never as YYYY-MM-DD (that form is for tool '
        "arguments), and never talk about records rolling over."
    )


# The internal record of what a turn did, copied into a reply by a model
# that saw the format: a whole line that opens with one, or a
# "[Done this turn: …]" inside a line. A bracket of the person's own
# ("[urgent]") is not one.
_INTERNAL_LINE = re.compile(
    r"^[ \t]*[\[(][ \t]*(?:done this turn|already done|what your earlier replies)\b"
    r".*$",
    re.I | re.M,
)
_INTERNAL_SPAN = re.compile(
    r"\[[ \t]*(?:done this turn|already done)\b[^\]\n]*\]?", re.I
)


def strip_internal(text: str) -> str:
    """``text`` without any internal note of what a turn did."""
    text = _INTERNAL_SPAN.sub("", _INTERNAL_LINE.sub("", text))
    text = re.sub(r"[ \t]+$", "", text, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def shaped(text: str) -> tuple[str, list[dict[str, Any]]]:
    """The reply as the chat shows it (:mod:`reply_format`): lists kept as
    plain-text bullets, tables lifted into table blocks, emphasis, heading
    marks and any internal note removed."""
    return reply_format.shape(strip_internal(text))


def plain_text(text: str) -> str:
    """The reply's text alone, as :func:`shaped` leaves it."""
    return shaped(text)[0]


def _strip_marks(delta: str) -> str:
    """A streamed piece without emphasis marks; the stored reply goes through
    :func:`shaped` and replaces the streamed one."""
    return reply_format.stream_piece(delta)


# A write the user asked for, a reply that says it happened, and no write
# tool that succeeded: the reply is checked against what the turn actually
# did (the constitution's deterministic-faithfulness rule), never trusted.
# An explicit ask to keep something ("remember", "from now on", Tagalog
# "tandaan"): the full rules make some models answer "Remembered: ..."
# without calling the tool, so a focused pass saves it first.
_ASKS_TO_REMEMBER = re.compile(
    r"\b(remember|don'?t forget|keep in mind|from now on|tandaan|"
    r"lagi mong)\b",
    re.I,
)
EXTRACT = """Save what the person asks you to remember about themselves, or
about how they want you to answer, with remember_fact: one call per separate
thing, as a short third-person statement with its kind (response_style for
how to answer). Set always_on for a hard constraint every answer must
respect: an allergy, a medical rule, something never to suggest. Call
nothing if there is nothing lasting to keep."""


def _remember_first(
    ctx: Ctx, resolved: ai.ResolvedModel, text: str, run: SolRun, stream: TurnStream
) -> list[str]:
    """Save what the message asks to keep; returns the step summaries."""
    tool = next(t for t in sol_tools(run) if t.name == "remember_fact")
    before = len(stream.steps)
    try:
        capture.run_agent(
            ctx,
            resolved,
            system=EXTRACT,
            messages=[HumanMessage(text)],
            tools=[tool],
            on_text=lambda d: None,
            max_turns=2,
            max_tool_calls=6,
            hooks=stream,
        )
    except capture.SeamError:
        return []
    return [
        s.summary
        for s in stream.steps[before:]
        if s.name == "remember_fact" and s.ok and s.summary
    ]


# Learning without being asked: after a reply, the person's message is read
# once more for lasting facts and preferences. Only a message that speaks
# about them, states a habit, or pushes back on the reply is read, so most
# turns cost nothing extra.
_ABOUT_ME = re.compile(
    r"\b(i|i'?m|im|i'?ve|i'?d|my|me|mine|myself|we|our|ako|ko|akin|aking|"
    r"namin|kami)\b",
    re.I,
)
# A standing habit or wish said in passing ("I always use zero-cal sugar",
# "just give me the portion"): worth keeping even inside a log.
_STANDING = re.compile(
    r"\b(always|usually|never|every ?time|from now on|prefer|instead of|"
    r"just (give|tell|show)|give me|don'?t (give|tell|show|ask|add)|stop|"
    r"lagi|palagi|parati|ayoko|huwag)\b",
    re.I,
)
LEARN = """Read the person's message and keep what will still be true and
useful weeks from now, with remember_fact: who they are (job, studies,
where they live), the people in their life (names, relation), health,
allergies, diet and training rules, goals and what they're working towards,
lasting likes and dislikes, routines, and how they want answers. One call
per separate fact, as a short third-person statement with its kind; set
always_on only for a hard constraint (an allergy, a medical rule).

A lasting habit or preference said while logging something IS worth
keeping, as the habit, not the log: "I had a De-Stresso latte, I always use
zero-cal sugar there" keeps "Uses zero-calorie sugar in drinks at
De-Stresso" (kind preference), not the latte.

When the message pushes back on the assistant's reply (shown as REPLY IT
ANSWERS), keep the lasting wish behind it as a response_style memory,
stated plainly and positively: "JUST GIVE ME THE PORTION" after a long
answer keeps "Wants portions given directly (grams per food) without
preamble". A one-off fix to one entry is not a lasting wish.

Do NOT keep: what they did or ate today, a purchase or a log entry, a
question, a one-time request, a feeling of the moment, or anything about
the assistant itself. Most messages hold nothing lasting: then call
nothing."""


def learn(
    ctx: Ctx,
    text: str,
    *,
    already: bool,
    wrote: bool = False,
    follows: str | None = None,
    pushback: bool = False,
) -> list[str]:
    """Save lasting facts and preferences the message holds that nobody
    asked to keep; runs after the reply has streamed. ``already``: this
    turn saved a memory with remember_fact, so the message isn't read
    again. A turn that logged something is still read: seen live, "I
    always use zero-calorie sugar at De-Stresso", said while logging a
    drink, was never kept, and the next estimate had 24 g of sugar. On such
    a turn (``wrote``) only a standing habit or wish is worth the call: "log
    my lunch" speaks about them and holds nothing lasting. ``pushback``:
    the message corrects or scolds the reply ``follows``, whose start is
    shown so the wish behind it can be kept."""
    about_me = bool(_ABOUT_ME.search(text)) and not text.rstrip().endswith("?")
    asks = pushback or bool(_STANDING.search(text)) or (about_me and not wrote)
    if already or len(text) < 12 or not asks:
        return []
    resolved = _resolve(ctx)
    if resolved is None:
        return []
    run = SolRun(ctx=ctx, me_id=uuid.uuid4(), emit=lambda event, data: None)
    run.judge = memory_judge(ctx, resolved)
    tool = next(t for t in sol_tools(run) if t.name == "remember_fact")
    saved: list[str] = []

    class Heard(capture.LoopHooks):
        def tool_finished(self, call_id: str, name: str, result: Any) -> None:
            if isinstance(result, dict) and result.get("status") not in (
                None,
                "duplicate",
            ):
                saved.append(name)

    said = text
    if pushback and follows:
        said = f"REPLY IT ANSWERS (start): {follows[:600]}\n\nTHEIR MESSAGE: {text}"
    try:
        capture.run_agent(
            ctx,
            resolved,
            system=LEARN,
            messages=[HumanMessage(said)],
            tools=[tool],
            on_text=lambda d: None,
            max_turns=2,
            max_tool_calls=4,
            hooks=Heard(),
        )
    except capture.SeamError:
        return []
    ctx.commit()
    return saved


# The day's food: macros, calories, nutrition, what is left to eat.
_ABOUT_NUTRITION = re.compile(
    r"\b(macros?|calories|kcal|protein|carbs|nutrition(al)?|"
    r"sat(urated)? fat|sodium|fiber|left to eat)\b",
    re.I,
)
_ASKS_TO_WRITE = re.compile(
    r"\b(add|log|record|remind|create|set|schedule|save|note|mark|complete|"
    r"finish|spent|paid|bought|ate|ran|weigh|weighed|journal|track|"
    r"confirm|approve|had|eaten|drank|breakfast|lunch|dinner|snack|"
    r"remember|don'?t forget|keep in mind|from now on)\b",
    re.I,
)
# Things to keep, named in a statement ("these are my tasks: …"), are a
# record to make; in a question ("how many tasks are left?") they are not.
_NAMES_RECORDS = re.compile(
    r"\b(tasks?|to-?dos?|list|reminders?|register|expenses?|workouts?|"
    r"meals?|habits?)\b",
    re.I,
)
# Numbers with a unit or a currency, said as a statement ("62.4 kg and 20%
# body fat for today"), are a record even with no verb. In a question they
# are not ("did I hit 60 kg?").
_GIVES_DATA = re.compile(
    r"\d(?:[.,]\d+)?\s*(?:kg|kgs|lb|lbs|%|km|mi|mins?|hrs?|hours?|reps?|"
    r"sets?|kcal|cal|pesos?|php)(?!\w)|[₱$]\s*\d",
    re.I,
)
# A message asking about records already kept, even without a question mark
# ("check my meals for today why there are no sat fat records"): a reply
# describing what was logged before is not a claim to have written now.
# Narrow on purpose: a list ("my tasks: check the deploy, …") or numbers
# given ("62.4 kg, scale isn't right") stay a record to make.
_ASKS_ABOUT = re.compile(
    r"^\s*(?:why|how|what|which|when|where|did|does|can|could)\b|"
    r"\b(?:why|check (?:my|if|whether|what|why)|look at my|not showing|"
    r"there (?:are|is) no|don'?t see|(?:is|are) missing)\b",
    re.I,
)
_CLAIMS_A_WRITE = re.compile(
    r"\b(added|logged|saved|recorded|created|scheduled|marked|set up|"
    r"updated|changed|rearranged|reordered|renamed|edited|moved|deleted|removed|archived|"
    r"i(?:'| ha)ve set|will remind|i'?ll remind|waiting for your (?:ok|confirmation)|"
    # A promise to write ("I'll log it for you now") with no write behind it.
    r"i'?ll (?:log|add|save|record)|i will (?:log|add|save|record)|let me (?:log|add|save)|"
    r"proposed|remembered|noted|i'?ll remember|got it, i'?ll keep)\b",
    re.I,
)
# Pointing at a Confirm button: true only when this reply left a write
# waiting, because Confirm buttons belong to this reply's own steps. Not
# "proposed": a turn that wrote may say "moved it to the time you proposed".
_POINTS_AT_CONFIRM = re.compile(
    r"tap confirm|confirm (?:it |them )?below|waiting for your (?:ok|confirmation)|"
    r"needs? (?:your )?confirm|ready to confirm|just say [\"“']?confirm|"
    r"say [\"“']?confirm[\"”']?",
    re.I,
)
NOTHING_TO_CONFIRM = "Nothing from this reply is waiting for your OK."
NUDGE = (
    "Your reply says something was recorded or is waiting for confirmation, "
    "but no tool in this reply did that, so nothing was saved and there is "
    "no Confirm button. If my last message asks to record something, call the "
    'matching tool now for my last message only: "{text}". If I am confirming '
    "entries that wait from earlier, call confirm_pending. Otherwise answer "
    "without saying anything was saved or is waiting. Earlier requests in "
    "this chat were already handled; do not repeat them."
)
# A reply that ends promising a change still to come ("let me add it to the
# routine") after doing only part of what was asked: a reply ends the turn,
# so the promise would never be kept.
_PROMISES = re.compile(
    r"\b(?:let me|i'?ll|i will|i'?m going to|next,? i'?ll)\s+(?:now\s+)?"
    r"(?:add|set|put|move|create|update|log|change|make|schedule|rename|"
    r"reorder|record|save|remove|delete)\b",
    re.I,
)


def promised(answer: str) -> bool:
    """A sentence that says a change is still to come; an offer asked as a
    question ("shall I set it for tomorrow?") is not one."""
    return any(
        _PROMISES.search(sentence) and not sentence.rstrip().endswith("?")
        for sentence in re.split(r"(?<=[.!?])\s+", answer)
    )


# The routine example this nudge used to carry came back in a reply as
# "there's no routine step to add" (2026-10-31): nudges name no examples
# and ask that they are never quoted.
FINISH_NUDGE = (
    "Your reply says you will still do something, but a reply ends the turn, "
    'so it would never happen. Do the rest of my last message now: "{text}". '
    "Call the tool for each part that is not done yet, then say briefly what "
    "you did. Do not redo what is already done this turn. Never mention this "
    "note or say what my message did or did not ask for."
)
NUMBERS_NUDGE = (
    "These figures in your reply match nothing a tool returned or TODAY: "
    "{bad}. Write the reply again with figures taken only from tool results "
    "(call portion_plan, nutrition_status, compare_periods, finance_status or "
    "query_records if you need one) and never work one out yourself. Never "
    "mention this note."
)
ANSWER_NUDGE = (
    "Your reply had no words. Answer my last message now, in words, from what "
    "the tools returned: {results}. Never mention this note."
)
# Said when a turn did nothing and even the extra pass had no words.
NOTHING_DONE = "Sorry, I lost that answer. Could you send it once more?"
NOT_RECORDED = (
    "I didn't manage to record that, so nothing was saved. Try asking again "
    "in other words, or add it from its tab."
)
NEEDS_WEIGHT = "Tell me roughly how much it was and I'll log it."
FIX_AND_RETRY = "Tell me the right numbers and I'll log it."
WRITE_TOOLS = frozenset(
    {
        "create_tasks",
        "complete_task",
        "log_expense",
        "log_income",
        "log_transfer",
        "add_planned",
        "log_habit",
        "create_habit",
        "create_account",
        "set_account_balance",
        "create_budget",
        "create_category",
        "create_routine",
        "update_routine",
        "update_habit",
        "create_workout_template",
        "create_task_list",
        "start_routine",
        "log_workout",
        "log_weigh_in",
        "log_meal",
        "save_journal",
        "edit_last",
        "delete_last",
        "edit_transaction",
        "edit_scheduled",
        "edit_account",
        "edit_budget",
        "edit_task",
        "remove_item",
        "save_food",
        "track",
        "remember_fact",
        "forget_fact",
        "confirm_pending",
        "discard_pending",
        # Seen live 2026-10-29: two edit_meal saves were followed by "nothing
        # was saved", because a meal edit was not counted as a write.
        "edit_meal",
        "copy_meal",
        "edit_weigh_in",
        "edit_workout",
        "start_workout",
        "create_exercise",
        "edit_exercise",
        "edit_workout_template",
        "set_macro_target",
        "fitness_settings",
        "edit_food",
        "start_focus",
        "focus_control",
        "stop_focus",
        "redo_undone",
    }
)
# Every other tool: it only reads or shows. A test holds each tool to exactly
# one of the two, so a new write can't be left out of WRITE_TOOLS.
READ_TOOLS = frozenset(
    {
        "lookup",
        "query_records",
        "stats_overview",
        "show_chart",
        "show_insights",
        "coach",
        "plan_day",
        "show_memories",
        "recall_memories",
        "reread_photos",
        "suggest",
        "read_photos",
        "web_search",
        "nutrition_status",
        "focus_status",
        "find_transactions",
        "list_scheduled",
        "find_fitness_logs",
        "find_foods",
        "portion_plan",
        "compare_periods",
        "finance_status",
        "find_tasks",
        "todo",
        "ask_choice",
        "load_tools",
    }
)


def not_recorded(steps: list[Any]) -> str:
    """The reply that replaces a claim no write backs: why the write was
    refused, from the turn's own failed steps, when one says."""
    why = [
        str(s.summary).removeprefix("Not saved: ")
        for s in steps
        if s.name in WRITE_TOOLS
        and not s.ok
        and str(s.summary).startswith("Not saved: ")
    ]
    if not why:
        return NOT_RECORDED
    return (
        f"I couldn't save that, so nothing was recorded: {why[-1]}. "
        f"{NEEDS_WEIGHT if 'portion weight' in why[-1] else FIX_AND_RETRY}"
    )


WAITING_STATES = ("proposed", "needs_input")


def _still_waiting(ctx: Ctx, steps: list[Step]) -> bool:
    """Whether a card this turn made still waits for the person, read from
    the cards as they are now (a card made and then dropped in the same
    turn does not count), never from what a step reported."""
    ids = [i for s in steps for i in s.card_ids()]
    return any(st in WAITING_STATES for st in capture.card_states(ctx, ids).values())


def _wrote(steps: list[Any]) -> bool:
    return any(
        s.name in WRITE_TOOLS and s.ok and s.summary != NOTHING_WAITING for s in steps
    )


# How to confirm, spelled out: the card in the reply has the button, so
# this was boilerplate in nearly every meal reply (Kai, 2026-11-01).
_HOW_TO_CONFIRM = re.compile(
    r"tap confirm|confirm (?:it |them )?below|just say [\"“']?confirm|"
    r"(?:or|and) say [\"“']?confirm|say [\"“']?confirm[\"”']? (?:to|and|if)",
    re.I,
)
# What joins a sentence to its how-to-confirm clause: "; you can", ", just".
_CONFIRM_TAIL = re.compile(
    r"(?:[\s,;:—–-]|\b(?:so|and|or|you can|you could|just|please|then|to save it)\b)*$",
    re.I,
)


def drop_confirm_how(answer: str) -> str:
    """``answer`` without the clauses that explain how to confirm a card
    this reply left waiting; a sentence that was only that goes whole."""
    lines = []
    for line in answer.split("\n"):
        kept = []
        for sentence in re.split(r"(?<=[.!?])\s+", line):
            m = _HOW_TO_CONFIRM.search(sentence)
            if m is None:
                kept.append(sentence)
                continue
            # "It's waiting for your OK; tap Confirm or just say confirm."
            # keeps "It's waiting for your OK."
            head = _CONFIRM_TAIL.sub("", sentence[: m.start()])
            if len(head.split()) >= 3:
                kept.append(head + ".")
        lines.append(" ".join(kept).strip())
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text or answer


def drop_confirm_talk(answer: str) -> str:
    """``answer`` without the sentences that point at a Confirm, saying
    instead that nothing from this reply waits."""
    lines = []
    for line in answer.split("\n"):
        kept = [
            s
            for s in re.split(r"(?<=[.!?])\s+", line)
            if not _POINTS_AT_CONFIRM.search(s)
        ]
        lines.append(" ".join(kept).strip())
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return f"{text}\n\n{NOTHING_TO_CONFIRM}" if text else NOTHING_TO_CONFIRM


def unbacked_claim(
    asked: str,
    answer: str,
    steps: list[Any],
    *,
    waiting: bool,
    question: bool = False,
) -> bool:
    """The reply claims something the turn's tools did not do: it points at
    a Confirm button while nothing of this turn waits (``waiting``, from
    the cards' state at the end of the turn), whatever else the turn
    wrote; or, with no write of this turn succeeding, it claims a write the
    user asked for. The user's wording only gates the second case, and a
    ``question`` turn (the intent step read it as a question, plan or redo)
    never makes it: "what should my portions be" answered with "the tilapia
    is logged" was replaced by "I didn't manage to record that"."""
    wrote = _wrote(steps)
    if _POINTS_AT_CONFIRM.search(answer) and not waiting:
        return True
    if question:
        return False
    about = (
        bool(_ASKS_ABOUT.search(asked))
        and ":" not in asked
        and not _GIVES_DATA.search(asked)
    )
    statement = "?" not in asked and not about
    asks = bool(_ASKS_TO_WRITE.search(asked)) or (
        statement
        and (bool(_GIVES_DATA.search(asked)) or bool(_NAMES_RECORDS.search(asked)))
    )
    return not wrote and asks and bool(_CLAIMS_A_WRITE.search(answer))


# Messages that slid out of the history window (``history_budget``) are
# folded into the chat's summary after the reply, at most SUMMARY_MAX_MSGS
# per call, so the start of a long chat is never simply lost.
SUMMARY_MSG_CHARS = 400
SUMMARY_MAX_MSGS = 40
SUMMARISE = """You keep a running summary of a person's conversation with
their life assistant. Merge the OLD SUMMARY with the NEW MESSAGES into one
summary of at most 200 words: ongoing threads, decisions, promises,
questions still open, preferences and corrections they gave (how they want
answers, what was wrong), how the conversation has gone. Keep the numbers
that were decided or stated as lasting (a target, a budget, a usual
portion, a dose); leave out numbers that change daily (today's totals,
balances, macros left) and anything the assistant only looked up. Plain
text, no lists."""


def _summary_row(ctx: Ctx) -> Companion | CompanionThread:
    """Where the running summary lives: the turn's chat (each chat has its
    own), or the companion row outside one."""
    return _THREAD.get() or companion_row(ctx)


def _summary_block(ctx: Ctx) -> str:
    row = _summary_row(ctx)
    if not row.summary:
        return ""
    return (
        "\nEARLIER CONVERSATION (summary; TODAY and ABOUT THEM win where "
        f"they differ):\n{row.summary}\n"
    )


def refresh_summary(ctx: Ctx, resolved: ai.ResolvedModel) -> None:
    """Fold the messages that slid out of the turn's history window into the
    summary. One short model call, only when something slid out; a failure
    leaves the summary as it was (the next turn tries again)."""
    row = _summary_row(ctx)
    window = {m.id for m in _window_rows(ctx, history_budget(resolved))}
    where: list[ColumnElement[bool]] = [
        col(CompanionMessage.text).is_not(None),
        *_thread_where(),
    ]
    if row.summary_through is not None:
        where.append(col(CompanionMessage.created_at) > row.summary_through)
    older = [
        m
        for m in owned_repo.list_rows(
            ctx,
            CompanionMessage,
            *where,
            order_by=[col(CompanionMessage.created_at)],
            limit=SUMMARY_MAX_MSGS,
        )
        # The window is the newest block, so these come first.
        if m.id not in window
    ]
    if not older:
        return
    lines = "\n".join(
        f"{'Person' if m.role == 'me' else 'Assistant'} "
        f"({ctx.clock.day_of(m.created_at).isoformat()}): "
        f"{(m.text or '')[:SUMMARY_MSG_CHARS]}"
        for m in older
    )
    try:
        text = capture.ask_text(
            ctx,
            resolved,
            system=SUMMARISE,
            text=f"OLD SUMMARY:\n{row.summary or '(none)'}\n\nNEW MESSAGES:\n{lines}",
        )
    except capture.SeamError:
        return
    row.summary = _strip_marks(text)[:2000] or row.summary
    row.summary_through = older[-1].created_at
    ctx.session.add(row)
    ctx.session.flush()


def summarise_later(ctx: Ctx, thread_id: uuid.UUID | None) -> None:
    """``refresh_summary`` for the chat ``thread_id``, after the reply is
    out (the route calls it), so folding older messages never delays one."""
    resolved = _resolve(ctx)
    if resolved is None:
        return
    token = _THREAD.set(thread_for(ctx, thread_id))
    try:
        refresh_summary(ctx, resolved)
    finally:
        _THREAD.reset(token)
    ctx.commit()


def estimate_tokens(text: str) -> int:
    """A message's tokens, estimated high (see CHARS_PER_TOKEN)."""
    return math.ceil(len(text) / CHARS_PER_TOKEN) + MSG_OVERHEAD_TOKENS


def history_budget(resolved: ai.ResolvedModel) -> int:
    """Tokens the chat's history may take in one turn: the model's window
    less the turn's own room, at most ``FERN_HISTORY_MAX_TOKENS`` (cost and
    the time to read a long prompt)."""
    room = ai.context_window(resolved) - TURN_RESERVE_TOKENS
    return max(0, min(settings.FERN_HISTORY_MAX_TOKENS, room))


def _window_rows(ctx: Ctx, budget: int) -> list[CompanionMessage]:
    """The chat's messages the turn sends, newest first: whole messages
    until ``budget`` tokens; the first that does not fit ends the window
    (nothing older is sent, so the history never skips a message)."""
    rows = owned_repo.list_rows(
        ctx,
        CompanionMessage,
        *_thread_where(),
        order_by=[col(CompanionMessage.created_at).desc()],
        limit=HISTORY_MAX_ROWS,
    )
    out: list[CompanionMessage] = []
    spent = 0
    for m in rows:
        sent = _sent(ctx, m)
        cost = estimate_tokens(str(sent.content) if sent else "")
        if spent + cost > budget:
            break
        spent += cost
        out.append(m)
    return out


# Said in place of a reply that ended with no words and nothing done, so a
# following "try again" points at the message before it.
FAILED_REPLY = "(That reply failed before finishing; nothing from it was done.)"
# Said in place of a reply that had no words but did something; what it
# did is in the system prompt's record of earlier replies.
ACTED_REPLY = "(That reply had no words; what it did is listed above.)"


PHOTO_READ_CHARS = 4000
PHOTO_HISTORY_CHARS = 1500


def _photo_read(m: CompanionMessage) -> str:
    """What a message's photos showed, as read when it was sent."""
    for b in m.blocks or []:
        if b.get("t") == "photos" and b.get("read"):
            return str(b["read"])[:PHOTO_HISTORY_CHARS]
    return ""


def _step_items(m: CompanionMessage) -> list[dict[str, Any]]:
    for b in m.blocks or []:
        if b.get("t") == "steps":
            items = b.get("items")
            if isinstance(items, list):
                return [i for i in items if isinstance(i, dict)]
    return []


def _item_card_ids(i: dict[str, Any]) -> list[str]:
    ids = [str(i["card_id"])] if i.get("card_id") else []
    return ids + [
        str(c["card_id"])
        for c in i.get("cards") or []
        if isinstance(c, dict) and c.get("card_id")
    ]


# What a step said about a card that waited, and what the card came to.
_WAIT_NOTE = re.compile(r" \((?:\d+ )?waiting for your OK\)$")
_QUESTION_NOTE = re.compile(r" \([^()]*\)$")
_SINCE = {
    "saved": "saved since",
    "edited": "saved since",
    "discarded": "dropped since",
    "undone": "undone since",
}


def _did_now(m: CompanionMessage, states: dict[str, str]) -> list[str]:
    """What a reply did, from its steps block, with each card that waited
    then described as it is now ("(saved since)"), so a settled entry is
    never presented as still waiting."""
    out = []
    for i in _step_items(m):
        summary = str(i.get("summary") or "")
        if not summary:
            continue
        now = [states.get(c) for c in _item_card_ids(i)]
        known = [s for s in now if s]
        if known and not any(s in WAITING_STATES for s in known):
            asked = i.get("state") == "needs_input" or any(
                isinstance(c, dict) and c.get("state") == "needs_input"
                for c in i.get("cards") or []
            )
            note = _WAIT_NOTE.search(summary) or (
                _QUESTION_NOTE.search(summary) if asked else None
            )
            if note:
                since = ", ".join(dict.fromkeys(_SINCE.get(s, s) for s in known))
                summary = f"{summary[: note.start()]} ({since})"
        out.append(summary)
    return out


EARLIER = """WHAT YOUR EARLIER REPLIES TODAY DID (records, not words to repeat; never copy this format into a reply):
{lines}
WAITING FOR THEIR OK NOW: {waiting}"""
EARLIER_ASKED_CHARS = 60


def _earlier_actions(ctx: Ctx, rows: list[CompanionMessage]) -> str:
    """The system prompt's record of what today's earlier replies did,
    oldest first, and what waits for the person now. ``rows`` is the
    history window, newest first."""
    today = [m for m in reversed(rows) if ctx.clock.day_of(m.created_at) == ctx.today]
    ids = [
        c
        for m in today
        if m.role != "me"
        for i in _step_items(m)
        for c in _item_card_ids(i)
    ]
    states = capture.card_states(ctx, ids)
    lines, asked = [], ""
    for m in today:
        if m.role == "me":
            asked = (m.text or "")[:EARLIER_ASKED_CHARS]
            continue
        did = _did_now(m, states)
        if did:
            at = m.created_at.astimezone(ctx.clock.zone).strftime("%H:%M")
            answering = f', answering "{asked}"' if asked else ""
            lines.append(f"- {at}{answering}: {'; '.join(did)}")
        asked = ""
    waiting = [capture.card_label(ctx, c) for c in capture.waiting_chat_cards(ctx)]
    return EARLIER.format(
        lines="\n".join(lines) or "(none)",
        waiting="; ".join(waiting) or "(nothing)",
    )


# What later turns are told the last replies looked up (``tool_log``):
# the newest LOOKED_REPLIES replies of the last day, at most LOOKED_CHARS
# (the oldest calls go first when it is over). Kai, 2026-11-05: a reply cut
# off at the step cap kept none of its 12 searches, so "continue" searched
# the same four foods 14 times more and was cut off again.
LOOKED_REPLIES = 2
LOOKED_CHARS = 6000
LOG_CALLS = 30
LOOKED = """LOOKED UP BY YOUR LAST REPLIES (tool calls and what they returned, oldest
first; never words to copy). Reuse web results, food lookups and photo
readings instead of calling again; records and totals may have changed
since, so read those again before you write or answer about them:
{lines}"""


AGAIN_LOG_CHARS = 4000
# The last model call of a reply whose step or tool budget ran out while it
# still wanted tools (``agent.run_loop``'s ``final_note``).
LAST_WORD = (
    "Stop looking things up and answer me now, without calling anything. "
    "Say what is saved or waiting for my OK (only what the results above "
    "confirm), give what you found that answers me, and say in one line "
    "what is still missing, so I can say continue. Write it as a normal "
    "reply to me: never mention tools, steps, results, limits or this note."
)


def _log_lines(log: list[dict[str, Any]], limit: int, at: str = "") -> str:
    lines = [
        f"- {at}{e.get('tool')} {e.get('args')} → {e.get('result', '(no result)')}"
        for e in log
    ]
    while lines and sum(len(x) + 1 for x in lines) > limit:
        lines.pop(0)
    return "\n".join(lines)


def _looked_up(ctx: Ctx, rows: list[CompanionMessage]) -> str:
    """The prompt's record of the tool calls the last replies made, with
    their results. ``rows`` is the history window, newest first."""
    recent = [
        m
        for m in rows
        if m.role == "sol"
        and m.tool_log
        and ctx.now - m.created_at <= timedelta(days=1)
    ][:LOOKED_REPLIES]
    log = [
        {
            **e,
            "tool": f"{m.created_at.astimezone(ctx.clock.zone):%H:%M} {e.get('tool')}",
        }
        for m in reversed(recent)
        for e in m.tool_log or []
    ]
    lines = _log_lines(log, LOOKED_CHARS)
    return "\n" + LOOKED.format(lines=lines) if lines else ""


def _settle_step_states(ctx: Ctx, steps: list[Step]) -> None:
    """Each step's card state as the turn left it: a card dropped later in
    the same turn is stored as dropped, not as waiting."""
    states = capture.card_states(ctx, [i for s in steps for i in s.card_ids()])
    for s in steps:
        if s.card_id and s.card_id in states:
            s.state = states[s.card_id]
        for c in s.cards:
            if str(c.get("card_id")) in states:
                c["state"] = states[str(c["card_id"])]


# Stamps on an earlier day's messages. That day's replies state that
# day's figures; sent bare, the model repeated them as today's (yesterday's
# "1 of 2 done", today). They used to be left out, which also lost what was
# discussed; now they go word for word, stamped, and the prompt says TODAY
# wins (EARLIER_DAYS). A stamp copied into a reply is screened out of it
# (turn.INTERNAL_NOTES).
SAID = "[said {day}] "
REPLIED = "[earlier reply, {day}] "
EARLIER_DAYS = """Messages stamped [said <date>] or [earlier reply, <date>] are
from that day: the figures in them were true then. Today's figures come
from TODAY and your tools; never repeat an earlier day's figure as today's,
and never write such a stamp yourself."""


_STAMP = re.compile(r"^\[(?:said|earlier reply,) \d{4}-\d{2}-\d{2}\] ")


def _unstamped(text: str) -> str:
    """A history message's words without its day stamp."""
    return _STAMP.sub("", text, count=1)


def _sent(ctx: Ctx, m: CompanionMessage) -> BaseMessage | None:
    """``m`` as the model gets it in the history; None when it carries
    nothing (a question with no text and no photo reading)."""
    day = ctx.clock.day_of(m.created_at)
    earlier = day != ctx.today
    if m.role == "me":
        read = _photo_read(m)
        if not (m.text or read):
            return None
        when = SAID.format(day=day.isoformat()) if earlier else ""
        return HumanMessage(f"{when}{m.text or ''}\n\n{read}".strip())
    # What a reply did goes in the system prompt (``_earlier_actions``),
    # never in its text: a note there was copied into new replies. An
    # older reply that already holds one is sent without it.
    text = strip_internal(m.text or "")
    fallback = (
        ACTED_REPLY if any(i.get("summary") for i in _step_items(m)) else FAILED_REPLY
    )
    when = REPLIED.format(day=day.isoformat()) if earlier else ""
    return AIMessage(f"{when}{text or fallback}")


def _spans_days(ctx: Ctx, rows: list[CompanionMessage]) -> bool:
    """Whether the window holds an earlier day's message (stamped)."""
    return any(ctx.clock.day_of(m.created_at) != ctx.today for m in rows)


def _history(ctx: Ctx, rows: list[CompanionMessage]) -> list[BaseMessage]:
    """The window's messages, oldest first, as the model gets them."""
    return [s for m in reversed(rows) if (s := _sent(ctx, m)) is not None]


def _last_exchange(history: list[BaseMessage]) -> tuple[str, str]:
    """The person's message before this one and Fern's reply to it, for a
    redo ("try again") and for not repeating the last suggestion."""
    asked = answered = ""
    for m in reversed(history):
        if isinstance(m, AIMessage) and not answered and not asked:
            answered = _unstamped(str(m.content))
        elif isinstance(m, HumanMessage):
            asked = _unstamped(str(m.content))
            break
    if answered in (FAILED_REPLY, ACTED_REPLY):
        answered = ""
    return asked, answered


RESULTS_CHARS = 3000


def _words_for(
    again: Callable[[str, str], str],
    reply: str,
    run: SolRun,
    steps: list[Step],
    *,
    allowed: bool,
) -> tuple[str, list[dict[str, Any]]]:
    """Words for a reply that ended with none. A turn that did something
    says so from its steps (no model call: the step rows already carry it);
    one that did nothing gets one pass to answer from what the tools
    returned, else an honest line. A blank reply is never sent (seen live:
    a portion question answered with nothing, then "try again")."""
    did = [
        s.summary
        for s in kept_steps(steps)
        if s.summary and s.ok and s.name in WRITE_TOOLS
    ]
    if did:
        return "\n".join(f"• {d}" for d in did) if len(did) > 1 else f"{did[0]}.", []
    if allowed:
        results = json.dumps(
            [{"tool": n, "result": r} for n, r in run.results],
            ensure_ascii=False,
            default=str,
        )[:RESULTS_CHARS]
        answer, tables = shaped(again(reply, ANSWER_NUDGE.format(results=results)))
        if answer or tables:
            return answer, tables
    return NOTHING_DONE, []


def _ask_ai(
    ctx: Ctx,
    resolved: ai.ResolvedModel,
    text: str,
    me_id: uuid.UUID,
    sol_id: uuid.UUID,
    sol_name: str,
    user_name: str,
    stream: TurnStream,
    *,
    photos: list[uuid.UUID] | None = None,
) -> AskOut:
    # The summary and memory embeddings are kept up to date after the reply
    # (``summarise_later``, ``memory.backfill`` from the route): run here,
    # they put a model call and an embedding call before the first word.
    first = brain.first_name(user_name)
    # What the reply's figures may come from besides this turn's tools:
    # TODAY and ABOUT THEM as the model saw them (the number check).
    grounds: list[Any] = []

    def make_system(turn_note: str) -> str:
        # Built after any memory this message asked for is saved, so the
        # reply already follows it.
        # Always-on memories, those relevant to this message (recalled
        # without a tool call) and the rules learned from feedback.
        mems = memory.context_block(ctx, text)
        facts = grounding.snapshot(ctx)
        grounds[:] = [facts, mems]
        return (SYSTEM + loop.BUDGET_RULES).format(
            sol=sol_name, user=first, correct_waiting=CORRECT_WAITING
        ) + CONTEXT.format(
            now_line=now_line(ctx),
            currency=ctx.currency.phrase,
            today_facts=json.dumps(facts, ensure_ascii=False)
            + (f"\n{MODULES_OFF}" if facts.get("modules_off") else ""),
            memories=mems,
            turn=turn_note,
            summary=_summary_block(ctx)
            + (f"\n{EARLIER_DAYS}\n" if _spans_days(ctx, rows) else ""),
            earlier=_earlier_actions(ctx, rows) + _looked_up(ctx, rows),
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

    rows = _window_rows(ctx, history_budget(resolved))
    history = _history(ctx, rows)
    me = _message(
        ctx,
        "me",
        text,
        [{"t": "photos", "media": [str(p) for p in photos]}] if photos else [],
        me_id,
    )
    stream.custom("message", _pub(ctx, me).model_dump(mode="json"))
    if photos:
        # The photos are read into text first, so Fern acts on them with
        # its usual tools whatever chat model the person picked.
        call = str(derived_id("fern-photos", me_id, "read"))
        stream.tool_started(call, "read_photos", {"photos": len(photos)})
        seen, read = capture.describe_photos(ctx, photos, text)
        stream.tool_finished(call, "read_photos", {"read": len(read)})
        # Kept with the message, so later turns know what the photos showed.
        me.blocks = [
            {**b, "read": seen[:PHOTO_READ_CHARS]} if b.get("t") == "photos" else b
            for b in me.blocks
        ]
        ctx.session.add(me)
        text = f"{text}\n\n{seen}".strip()
    run = SolRun(ctx=ctx, me_id=me_id, emit=stream.frame)
    # What the person said today, newest last: "register those" leans on the
    # message before it, so a day named there still counts for a due date.
    earlier = [str(m.content) for m in history if isinstance(m, HumanMessage)]
    writes, wrun = capture.chat_write_tools(
        ctx,
        client_uuid=derived_id("fern-turn", me_id, "capture"),
        text=text,
        emit=stream.frame,
        said="\n".join([*earlier[-3:], text]),
    )
    run.said = text
    run.turn_capture = lambda: wrun.cap.id if wrun.cap is not None else None
    writes = [
        with_day_after(ctx, t)
        if t.name == "log_meal"
        else without_duplicate_tasks(ctx, t)
        if t.name == "create_tasks"
        else t
        for t in writes
    ]
    run.judge = memory_judge(ctx, resolved)
    # Every tool on every turn (loop.py): the common ones in full, so the
    # model gathers in one round; the rarely used ones by name, loaded on
    # demand (``loop.DEFERRED``).
    every = [
        recording(run, t)
        for t in [
            *sol_tools(run),
            *writes,
            loop.todo_tool(),
            loop.choice_tool(run.block),
        ]
    ]
    core = [t for t in every if t.name not in loop.DEFERRED]
    later = [t for t in every if t.name in loop.DEFERRED]
    saved_now = (
        _remember_first(ctx, resolved, text, run, stream)
        if _ASKS_TO_REMEMBER.search(text)
        else []
    )
    # The job, decided before the model runs (intent.py), and the last
    # exchange it may have to redo.
    job = intent.classify(text)
    asked_before, answered_before = _last_exchange(history)
    system = make_system(
        intent.turn_note(
            job, previous_ask=asked_before, previous_answer=answered_before
        )
    )
    if saved_now:
        system += (
            "\nSAVED THIS TURN (already done; confirm it in a few words and "
            "follow it from now on):\n" + "\n".join(f"- {s}" for s in saved_now)
        )
    question = job.kind in ("question", "plan", "redo")
    turn = [*history, HumanMessage(text)]
    # Loop guards (``agent.run_loop``): repeated reads answered from the
    # first, and a last word without tools when the budget runs out.
    guards: dict[str, Any] = {"writes": WRITE_TOOLS, "final_note": LAST_WORD}

    def again(reply_so_far: str, nudge: str) -> str:
        """One corrective pass: the reply so far and a note, with every
        tool (the pass may need one this turn's words missed)."""
        done = [s.summary for s in stream.steps if s.ok and s.summary]
        if done:
            nudge += (
                "\n\nAlready done in this reply (do not redo, and do not quote "
                "this list): " + "; ".join(done)
            )
        if stream.log:
            # A pass starts from the reply's words alone: without what the
            # reply looked up it searched everything again.
            nudge += "\n\nWhat this reply already looked up (reuse it):\n" + (
                _log_lines(stream.log, AGAIN_LOG_CHARS)
            )
        stream.end_text()
        return capture.run_agent(
            ctx,
            resolved,
            system=system,
            messages=[
                *turn,
                AIMessage(strip_internal(reply_so_far)),
                HumanMessage(nudge),
            ],
            tools=core,
            deferred=later,
            on_text=lambda d: stream.text(_strip_marks(d)),
            max_turns=MAX_STEPS,
            max_tool_calls=MAX_TOOL_CALLS,
            hooks=stream,
            think_every=True,
            **guards,
        )

    reply = capture.run_agent(
        ctx,
        resolved,
        system=system,
        messages=turn,
        tools=core,
        deferred=later,
        on_text=lambda d: stream.text(_strip_marks(d)),
        max_turns=MAX_STEPS,
        max_tool_calls=MAX_TOOL_CALLS,
        hooks=stream,
        # Thinks before every round, not only the first: reading the
        # results it gathered is where a wrong assumption gets caught.
        think_first=True,
        think_every=True,
        **guards,
    )
    answer, tables = shaped(reply)
    unbacked = unbacked_claim(
        text,
        answer,
        stream.steps,
        waiting=_still_waiting(ctx, stream.steps),
        question=question,
    )
    passes = 0
    if stream.stopped():
        # Stopped for the person's next message: what was done stays, and
        # the reply ends as it is instead of being made to finish.
        stream.end_text()
        answer = answer or STOPPED
    elif unbacked or (promised(answer) and not question):
        # One corrective pass: told plainly that nothing was saved, or that
        # part of the ask was only promised. What is already done goes in
        # the nudge, never as a note on the reply (a note there was copied
        # into replies).
        passes += 1
        reply = again(reply, (NUDGE if unbacked else FINISH_NUDGE).format(text=text))
        answer, tables = shaped(reply)
        if unbacked_claim(
            text,
            answer,
            stream.steps,
            waiting=_still_waiting(ctx, stream.steps),
            question=question,
        ):
            # A turn that did something real (a drop, a search) keeps it;
            # only the talk of a Confirm that isn't there goes. The canned
            # "nothing was saved" is only for a turn that asked for a write.
            answer = (
                drop_confirm_talk(answer)
                if _wrote(stream.steps) or question
                else not_recorded(stream.steps)
            )
    if not stream.stopped():

        def backed_by() -> list[Any]:
            # Read fresh: a fix pass may have called more tools.
            return [
                *(r for _, r in run.results),
                *grounds,
                text,
                *earlier,
                *(s.summary for s in stream.steps if s.summary),
            ]

        bad = numbers.unmatched(answer, backed_by())
        if bad and passes < MAX_FIX_PASSES:
            # Figures nothing backs: one pass to answer from the tools; what
            # still doesn't trace after it goes, sentence by sentence.
            passes += 1
            reply = again(
                reply, NUMBERS_NUDGE.format(bad=", ".join(map(numbers.fmt, bad)))
            )
            answer, tables = shaped(reply)
            answer = numbers.drop_sentences_with(
                answer, numbers.unmatched(answer, backed_by())
            )
        if not answer.strip() and not tables and not run.blocks:
            answer, tables = _words_for(
                again, reply, run, stream.steps, allowed=passes < MAX_FIX_PASSES
            )
    if _still_waiting(ctx, stream.steps):
        # The card shows Confirm; the reply needn't explain it.
        answer = drop_confirm_how(answer)
    run.blocks.extend(tables)
    # Logged into a module switched off: kept, with one line per module
    # saying it won't show on Today and a button to turn it back on.
    # A hidden part heard for the first time is offered back once (Turn on /
    # Not for me), in place of the plain note; the offer is kept on the
    # account so it is never made again.
    offered, dismissed = profile.intro_state(ctx)
    offers = reintro.to_offer(
        reintro.heard(text, capture.written_parts(ctx, wrun.made)),
        hidden=profile.hidden_parts(ctx),
        offered=offered,
        dismissed=dismissed,
    )
    if offers:
        profile.mark_intro_offered(ctx, offers)
    for part in offers:
        run.block(reintro.block(part))
    for note in capture.off_module_notes(ctx, wrun.made, skip=offers, quiet=dismissed):
        run.block(note)
    if _ABOUT_NUTRITION.search(text) and not any(
        b["t"] == "nutrition" for b in run.blocks
    ):
        # Asked about the day's food and answered from memory: the card
        # still shows, since a model copying its earlier replies may skip
        # the tool that draws it.
        run.block({"t": "nutrition", "day": ctx.today.isoformat()})
    cap_id = capture.finish_chat_capture(ctx, wrun, reply=answer)
    _settle_step_states(ctx, stream.steps)
    steps = stream.steps_block()
    blocks = ([steps] if steps else []) + list(run.blocks)
    out = _message(ctx, "sol", answer or None, blocks, sol_id)
    if stream.log:
        out.tool_log = [{k: v for k, v in e.items() if k != "id"} for e in stream.log][
            -LOG_CALLS:
        ]
        ctx.session.add(out)
    ctx.commit()
    return AskOut(
        kind="reply",
        engine="ai",
        messages=[_pub(ctx, me), _pub(ctx, out)],
        capture=capture.capture_detail(ctx, cap_id) if cap_id else None,
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
