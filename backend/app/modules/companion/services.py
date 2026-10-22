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
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal

from fastapi import HTTPException
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, Field
from sqlalchemy import ColumnElement
from sqlmodel import col

from app.modules.ai_providers import public as ai
from app.modules.capture import public as capture
from app.modules.companion import brain, grounding, memory, routing, web
from app.modules.companion.defaults import COMPANION_NAME
from app.modules.companion.models import (
    MEMORY_KINDS,
    Companion,
    CompanionMessage,
    Memory,
    Tracker,
)
from app.modules.companion.schema import (
    AskOut,
    Insight,
    MessagePublic,
    Metric,
    SeriesOut,
    TrackerIn,
)
from app.modules.companion.turn import NOTHING_WAITING, TurnStream
from app.modules.fitness import public as fitness
from app.modules.profile import public as profile
from app.modules.stats import public as stats
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.ids import derived_id

Emit = Callable[[str, dict[str, Any]], None]
# What one companion answer may cost. The model sees the last HISTORY messages
# of the user's current day, each cut to HISTORY_CHARS, and gets at most
# MAX_STEPS model calls and MAX_TOOL_CALLS tool calls (enough to look
# something up, write several records and answer); tool results are cut in
# capture's loop (``agent.MAX_TOOL_RESULT_CHARS``).
HISTORY = 6
HISTORY_CHARS = 600
MAX_STEPS = 6
MAX_TOOL_CALLS = 20


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


class WebSearchArgs(BaseModel):
    query: Annotated[str, Field(min_length=2, max_length=200)]


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
    # What the person said this turn (with any photo reading).
    said: str = ""
    # Decides whether a new memory close to an old one is the same, an
    # update, a contradiction or different (the chat model; None: no judge).
    judge: memory.Judge | None = None
    # What `recall_memories` found this turn: it runs once a turn, so a model
    # that keeps searching (an empty result invites another try) gets the
    # same answer back and is told to reply instead of looping to the step cap.
    recalled: list[dict[str, Any]] | None = None

    def block(self, b: dict[str, Any]) -> dict[str, Any]:
        self.blocks.append(b)
        self.emit("block", b)
        return {"shown": b["t"]}


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
        saved = memory.remember(
            ctx,
            text=a.fact,
            kind=a.kind,
            tags=a.tags,
            importance=a.importance,
            always_on=a.always_on,
            source="said",
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

    def nutrition_status(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        # The person sees the day as a card (rings for the goals, bars for
        # the limits), once per reply however often the model asks.
        if not any(b["t"] == "nutrition" for b in run.blocks):
            run.block({"t": "nutrition", "day": ctx.today.isoformat()})
        # Fresh from the records, so a meal logged earlier in this turn
        # counts; a meal waiting for the user's OK does not, yet.
        return fitness.nutrition_today(ctx)

    def web_search(**kw: Any) -> dict[str, Any]:
        a = WebSearchArgs(**kw)
        query = own_words(a.query, run.said)
        try:
            return {"query": query, "results": web.search(query)}
        except web.WebSearchError as exc:
            return {"error": exc.code}

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
        return capture.settle_waiting(ctx, action="confirm")

    def discard_pending(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        return capture.settle_waiting(ctx, action="discard")

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
        (forget_fact, ForgetArgs, "Forget one remembered fact by its id."),
        (show_memories, NoArgs, "Show what you remember about the user."),
        (suggest, ChipsArgs, "Offer up to four follow-up prompts as chips."),
        (lookup, LookupArgs, "Look up a number in the user's own data."),
        (
            nutrition_status,
            NoArgs,
            "Today's food against the macro target: eaten (calories, protein, "
            "carbs, fat, fiber, saturated fat, sugar, sodium), target, what is "
            "left, meals logged, latest weigh-in. Call it for any question "
            "about macros, calories or what is left, and after logging a meal.",
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
            NoArgs,
            "Drop every entry from recent chat turns that is waiting for the "
            "user's OK, when they say cancel, no, don't save it.",
        ),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=desc, args_schema=schema
        )
        for fn, schema, desc in specs
    ]


SYSTEM = """You are {sol}, the companion inside Personal SOP, a life-logging
app. The user is {user}. NOW at the end gives today's date, the time where
they live and when their day rolls over: before the rollover "today" in their
records still means the previous date, but "tonight", "later" and "in an
hour" mean the next such time after right now.
Never schedule something in the past unless they ask for it.

Voice: calm, plain, specific, like a steady friend who pays attention. One idea
per message, at most three short sentences in one paragraph. English, or Taglish if they write it.

Format: plain text only. No markdown: no asterisks, no headings, no bullet or
numbered lists, no tables. The cards you show carry any list.

Facts: every fact you state about the user (habits, tasks, streaks, scores,
money, training, food, plans, projects, people) must come from TODAY below, from
ABOUT THEM, from `recall_memories`, or from a tool result in this conversation. Never invent
one, never guess a number, never assume a habit, project or goal. If something
is missing, say plainly that you don't have it yet and suggest logging it. Zero
or empty means none, so say so, never praise consistency you cannot see. Today's
due items are habits_due_today, tasks_due_today and fitness_due_today together;
say "Nothing is due today." only when all three are empty. The life score the
user sees on Today is life_score_7_days_shown_on_today. TODAY is current;
where an earlier message in this chat says otherwise, TODAY is right.

Acting: act only on the user's latest message; what earlier messages asked
for was already handled, so never record it again. You can work in several
steps. Call tools, read what they return,
call more if needed, then answer. When the user asks you to add, log, record,
remind, complete or change something, do it with the matching tool yourself;
never only say you will. The same goes when they simply describe things to
keep: tasks, to-dos or a list of what they need to work on, money spent,
workouts, weight, meals. Record them in this same reply without waiting to
be told to register or add them; listing them back is not recording them.
- To-dos and reminders: `create_tasks`, all of them in one call. Turn
  relative times into due_date (YYYY-MM-DD) and due_time (HH:MM, 24h) from
  Today. Give a due_date or due_time only when they name a day or a time;
  otherwise leave both out (never default to today or 23:59). Set remind
  only when they ask to be reminded.
- Finishing a task: `complete_task`. Money: `log_expense`, `log_income`,
  `log_transfer`, `add_planned`. Bills and pay-later plans (often in photos):
  each bill with a due date is its own one-time `add_planned` with that
  `due_date` (exact year from the photo); `day_of_month` only for something
  that repeats monthly. A credit card screen: the card balance or
  outstanding amount is what is owed (`set_account_balance` with it as a
  negative number); the payment due is a one-time `add_planned` on its due
  date, never the balance. Money said in another currency ($20, 20
  dollars, 15 USD): pass the number they said (20) with `currency` "USD".
  The app converts it at today's exchange rate; never convert it yourself
  and never guess a rate. Habits: `log_habit`, `create_habit`.
  Training and body: `log_workout`, `log_weigh_in`, `log_meal`. Journal:
  `save_journal`. Fixing the last entry: `edit_last`, `delete_last`.
- Setting things up is yours to do too, in this same reply: a new money
  account (`create_account`, its balance today, 0 if not given), the
  balance of an account they already have, opening or corrected
  (`set_account_balance`, one call per account), a monthly
  budget (`create_budget`), a habit (`create_habit` with its type, target,
  days and time when said), a routine of timed steps such as a morning
  routine (`create_routine`), a gym routine or workout plan
  (`create_workout_template`, exercises with sets), a task list
  (`create_task_list`, with any items). Fill in only what they said; never
  invent amounts, steps or exercises. These save at once with Undo on the
  step, so say what was created.
- Changing or removing what they already have is yours too; never say you
  can't. Find it first, then change it: transactions with
  `find_transactions` then `edit_transaction` (amount, category, account,
  payee, note, day); scheduled income and bills with `list_scheduled` then
  `edit_scheduled` (to move every item off an account at once, give
  `from_account` and the new `account`); an account's name, type (a credit
  card is type credit) or limit with `edit_account`; a budget with
  `edit_budget`; a task with `edit_task`; a habit or routine with
  `update_habit` / `update_routine`. Deleting a transaction, task, meal or
  weigh-in, or archiving a scheduled item, account, budget, habit or
  routine: `remove_item` (meals and weigh-ins: `find_fitness_logs` first).
  Edits save at once with Undo; removals wait for their Confirm.
- One message can hold several things to record: make every call.
- Only a tool result saves anything. Never say something was logged,
  saved, added or is waiting unless a tool in this reply returned it; if no
  tool ran, nothing was saved.
- A write that returns state "proposed" or "needs_input" waits for the
  user's OK: say it is waiting and that they can tap Confirm on it or just
  say "confirm". Mention Confirm only for a write from this reply, never for
  one from an earlier message. Never say it is done, and never tell them to
  "check the app" (they are in it). Name what was saved and what waits,
  separately.
- When they say confirm, yes, save it or go ahead about entries waiting
  from earlier, call `confirm_pending`; when they say cancel or don't save
  it, call `discard_pending`. Never record those entries again. Report
  what `confirm_pending` could not save and why (an expense needs an
  account first).
- A write that returns an error did not happen; say so plainly.
Show charts, insights, coaching, plans, trackers and memories with their
tools instead of describing them; each returns what its card shows, so speak
only to that. Use `lookup` for a number not in TODAY. When they name a food,
dish, drink or product you don't know well (a restaurant or branded item,
a local dish), call `web_search` first for that item alone, in the user's
own words plus "nutrition", for example "<restaurant> <dish> nutrition";
never add words they didn't say (no "sandwich" for "chicken") and never add
the rest of the meal to the query. Name `log_meal` items in their words too. Then call `log_meal` in the same turn: the
searched item scaled to what they ate, and common foods (rice, eggs, bread)
as their own items from standard values (1 cup cooked white rice is about
205 kcal, 4 g protein, 45 g carbs). If the results have nothing for that
exact item, use the closest match and say which. Mention the source in a few
words. Never present a web number as
the user's own data.
For macros, calories, nutrition or "what's left today", always call
`nutrition_status`, even though TODAY below has the numbers: the call is what
shows the person their nutrition card, which has every number. Then answer in
one or two sentences with what matters most (calories and protein left, and
any limit they are near or over), however earlier replies were worded. Don't
list every macro. After `log_meal`, report the day from its `day_after_this_meal`.
Food library: the user's saved nutrition facts are the first source for
any food. When they send a nutrition label (a photo, or the numbers typed
from one) or give a food's nutrition themselves, call `save_food` with the
values exactly as given and what they are per (100 g, piece or serving,
with the serving's grams when shown), then log what they ate if they did.
A label photo is saved for you; don't save it twice. Before estimating a
packaged or regular food, `find_foods` to use their own values; `log_meal`
also swaps in library values for matching foods by itself, and its
`from_library` says which, so say those are from their library.
Planning the rest of the day: after a meal is logged, and whenever they ask
what to eat, if `meals_ahead` is not empty suggest one concrete meal for each
meal still ahead (name it: lunch, dinner), each sized to `per_meal_ahead`:
protein first, calories close to it, and under its share of every limit in
`limits_left` (saturated fat, sugar, sodium); say which limit is tight if
one is. Use everyday foods they can actually get (Filipino meals, home
cooking, common chains), favour foods from `recent_foods`, and give each
food in grams or cups with rough kcal and protein, as one short line per
meal. These are suggestions, not logs: never call `log_meal` for them. If
they have already gone over a limit, say so once and keep the rest of the
day well under it.
A follow-up after every write: whenever this reply recorded something
(money, a weigh-in, a workout, a habit, a task, a meal), end with one short
line of insight or recommendation for that area, after the line saying
what was saved. Money: how the category or budget stands this month, or
what is safe to spend before payday. Weigh-in: the trend against last
week, never one day's number. Workout: what to aim for next session
(a little more weight or reps where they hit their sets) or what to train
next. Habit: the streak, or the next habit due today. Task: what is next or
overdue today. Meal: the plan for the meals ahead, as above. Use only
numbers from a tool result in this reply or from TODAY and ABOUT THEM below;
when you need one, call `lookup`, `stats_overview` or `nutrition_status`
first. With no number to stand on, give one practical tip instead, and
never invent one. Keep it to one sentence (the meal plan may take one line
per meal), and skip it when they only asked a question or said no thanks.
Never add up or subtract
numbers yourself; a meal still waiting for their OK is not counted yet,
so say so if one is. Never call the same tool
twice with the same arguments. After acting, answer in one or two short
sentences saying what you did. Do every part of a
many-part ask with its own tool call before replying; never end on "let
me…" for an undone part. Answer the latest message, not earlier ones.

Memory: ABOUT THEM below is always true for {user}: follow its answer style
and constraints in every reply. Anything else you know about them (likes,
people, health, plans, past events) is found with `recall_memories`; call it
before answering a personal question you are unsure of, not for every turn.
When they say "remember", "from now on" or "keep in mind", or tell you
something lasting about themselves or how they want answers, call
`remember_fact` in this same reply (one short statement per call, with its
kind); a repeat is recognised, so don't check first. Never say you'll
remember something without calling it. Use `forget_fact` with an id when they ask.
"""

# What changes every turn goes after the rules, so the rules and the tools
# stay one prefix a provider can cache across turns and days.
CONTEXT = """
NOW: today is {today}; it is {now} where they live; their day rolls over at {day_start}.

TODAY (JSON, from the user's records; a missing key is unknown, not zero;
money is in {currency}):
{today_facts}

ABOUT THEM (always respect; ids for forgetting):
{memories}

What you are tracking for them:
{trackers}
{summary}"""

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
# once more for lasting facts about them. Only a message that speaks about
# them is read, so most turns cost nothing extra.
_ABOUT_ME = re.compile(
    r"\b(i|i'?m|im|i'?ve|i'?d|my|me|mine|myself|we|our|ako|ko|akin|aking|"
    r"namin|kami)\b",
    re.I,
)
LEARN = """Read the person's message and keep what will still be true and
useful weeks from now, with remember_fact: who they are (job, studies,
where they live), the people in their life (names, relation), health,
allergies, diet and training rules, goals and what they're working towards,
lasting likes and dislikes, routines, and how they want answers. One call
per separate fact, as a short third-person statement with its kind; set
always_on only for a hard constraint (an allergy, a medical rule).

Do NOT keep: what they did or ate today, a purchase or a log entry, a
question, a request or command, a feeling of the moment, or anything about
the assistant. Most messages hold nothing lasting: then call nothing."""


def learn(ctx: Ctx, text: str, *, already: bool) -> list[str]:
    """Save lasting facts the message holds that nobody asked to keep; runs
    after the reply has streamed. ``already``: this turn saved a memory
    (asked for, or by the reply itself), so the message isn't read again."""
    if (
        already
        or len(text) < 12
        or text.rstrip().endswith("?")
        or not _ABOUT_ME.search(text)
    ):
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

    try:
        capture.run_agent(
            ctx,
            resolved,
            system=LEARN,
            messages=[HumanMessage(text)],
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
# waiting, because Confirm buttons belong to this reply's own steps.
_POINTS_AT_CONFIRM = re.compile(
    r"tap confirm|confirm (?:it |them )?below|waiting for your (?:ok|confirmation)|"
    r"needs? (?:your )?confirm|\bproposed\b",
    re.I,
)
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


FINISH_NUDGE = (
    "Your reply says you will still do something, but a reply ends the turn, "
    'so it would never happen. Do the rest of my last message now: "{text}". '
    "Call the tool for each part that is not done yet (a routine step is "
    "added with update_routine), then say in one or two sentences what you "
    "did. Do not redo what is already done this turn."
)
NOT_RECORDED = (
    "I didn't manage to record that, so nothing was saved. Try asking again "
    "in other words, or add it from its tab."
)
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
        "confirm_pending",
        "discard_pending",
    }
)


def unbacked_claim(asked: str, answer: str, steps: list[Any]) -> bool:
    """The reply claims something the turn's tools did not do, while no
    write tool of this turn succeeded: it points at a Confirm button with
    nothing of this turn waiting, or it claims a write the user asked for.
    The user's wording only gates the second case."""
    waiting = any(
        getattr(s, "state", None) in ("proposed", "needs_input")
        or any(
            c.get("state") in ("proposed", "needs_input")
            for c in getattr(s, "cards", None) or []
        )
        for s in steps
    )
    wrote = any(
        s.name in WRITE_TOOLS and s.ok and s.summary != NOTHING_WAITING for s in steps
    )
    if _POINTS_AT_CONFIRM.search(answer) and not waiting and not wrote:
        return True
    statement = "?" not in asked
    asks = bool(_ASKS_TO_WRITE.search(asked)) or (
        statement
        and (bool(_GIVES_DATA.search(asked)) or bool(_NAMES_RECORDS.search(asked)))
    )
    return not wrote and asks and bool(_CLAIMS_A_WRITE.search(answer))


# Fold older messages into the summary once a day's conversation is behind
# (SUMMARY_AFTER of them from earlier days), or within a long day once
# SUMMARY_AFTER_TODAY have fallen out of the window: one short call then,
# instead of resending or losing them.
SUMMARY_AFTER = 4
SUMMARY_AFTER_TODAY = 20
SUMMARY_MSG_CHARS = 400
SUMMARY_MAX_MSGS = 40
SUMMARISE = """You keep a running summary of a person's conversation with
their life assistant. Merge the OLD SUMMARY with the NEW MESSAGES into one
summary of at most 150 words: ongoing threads, decisions, promises,
questions still open, how the conversation has gone. Leave out numbers that
change daily (totals, balances, macros) and anything the assistant only
looked up. Plain text, no lists."""


def _summary_block(ctx: Ctx) -> str:
    row = companion_row(ctx)
    if not row.summary:
        return ""
    return (
        "\nEARLIER CONVERSATION (summary; TODAY and ABOUT THEM win where "
        f"they differ):\n{row.summary}\n"
    )


def refresh_summary(ctx: Ctx, resolved: ai.ResolvedModel) -> None:
    """Fold the messages older than the turn window into the summary once
    SUMMARY_AFTER of them have built up. One short model call; a failure
    leaves the summary as it was (the next turn tries again)."""
    row = companion_row(ctx)
    # Only what _history actually sends is excluded: an earlier day's
    # message in the last HISTORY is not sent, so it is summarised.
    window = {
        m.id for m in _window_rows(ctx) if ctx.clock.day_of(m.created_at) == ctx.today
    }
    where: list[ColumnElement[bool]] = [col(CompanionMessage.text).is_not(None)]
    if row.summary_through is not None:
        where.append(col(CompanionMessage.created_at) > row.summary_through)
    older = [
        m
        for m in owned_repo.list_rows(
            ctx,
            CompanionMessage,
            *where,
            order_by=[col(CompanionMessage.created_at)],
            limit=SUMMARY_MAX_MSGS + HISTORY,
        )
        if m.id not in window
    ][:SUMMARY_MAX_MSGS]
    earlier_days = [m for m in older if ctx.clock.day_of(m.created_at) < ctx.today]
    if len(earlier_days) < SUMMARY_AFTER and len(older) < SUMMARY_AFTER_TODAY:
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


def _window_rows(ctx: Ctx) -> list[CompanionMessage]:
    return owned_repo.list_rows(
        ctx,
        CompanionMessage,
        order_by=[col(CompanionMessage.created_at).desc()],
        limit=HISTORY,
    )


# Said in place of a reply that ended with no words and nothing done, so a
# following "try again" points at the message before it.
FAILED_REPLY = "(That reply failed before finishing; nothing from it was done.)"


def _did(m: CompanionMessage) -> list[str]:
    """What a reply did, from its steps block: the finished steps' sentences."""
    for b in m.blocks or []:
        if b.get("t") == "steps":
            items = b.get("items")
            if isinstance(items, list):
                return [
                    str(i["summary"])
                    for i in items
                    if isinstance(i, dict) and i.get("summary")
                ]
    return []


def _with_done(text: str, steps: list[Any]) -> str:
    """A reply with what this turn's tools already did, for the corrective
    pass (it sees the reply's words, not its tool calls)."""
    did = [s.summary for s in steps if getattr(s, "ok", False) and s.summary]
    return f"{text}\n[Done this turn: {'; '.join(did)}]".strip() if did else text


def _history(ctx: Ctx) -> list[BaseMessage]:
    rows = _window_rows(ctx)
    out: list[BaseMessage] = []
    for m in reversed(rows):
        # An earlier day's replies state that day's facts; sent along, the
        # model repeats them over TODAY's (yesterday's "1 of 2 done", today).
        if ctx.clock.day_of(m.created_at) != ctx.today:
            continue
        if m.role == "me":
            if m.text:
                out.append(HumanMessage(m.text[:HISTORY_CHARS]))
            continue
        # A reply carries what it did as well as what it said: without its
        # steps the model can't see a habit it already created, and re-asks
        # or redoes the turn before (a meal confirmed twice).
        did = _did(m)
        text = (m.text or "")[:HISTORY_CHARS]
        if did:
            text = f"{text}\n[Done this turn: {'; '.join(did)}]".strip()
        out.append(AIMessage(text or FAILED_REPLY))
    return out


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
    refresh_summary(ctx, resolved)
    # Memories kept while no embedding model answered, or from before the
    # memory layer, are embedded as they are next needed.
    memory.backfill(ctx, limit=20)
    first = brain.first_name(user_name)

    def make_system() -> str:
        # Built after any memory this message asked for is saved, so the
        # reply already follows it.
        mems = memory.always_on(ctx)
        return SYSTEM.format(sol=sol_name, user=first) + CONTEXT.format(
            today=ctx.today.isoformat(),
            now=ctx.now.astimezone(ctx.clock.zone).strftime("%A %Y-%m-%d %H:%M"),
            day_start=f"{ctx.clock.start_hour:02d}:00",
            currency=ctx.currency.phrase,
            today_facts=json.dumps(grounding.snapshot(ctx), ensure_ascii=False),
            memories="\n".join(f"- [{m.id}] ({m.kind}) {m.text}" for m in mems)
            or "(nothing yet)",
            summary=_summary_block(ctx),
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
    writes = [with_day_after(ctx, t) if t.name == "log_meal" else t for t in writes]
    run.judge = memory_judge(ctx, resolved)
    every = [*sol_tools(run), *writes]
    offered = routing.pick(text, earlier, photos=bool(photos))
    tools = every if offered is None else [t for t in every if t.name in offered]
    saved_now = (
        _remember_first(ctx, resolved, text, run, stream)
        if _ASKS_TO_REMEMBER.search(text)
        else []
    )
    system = make_system()
    if saved_now:
        system += (
            "\nSAVED THIS TURN (already done; confirm it in a few words and "
            "follow it from now on):\n" + "\n".join(f"- {s}" for s in saved_now)
        )
    turn = [*history, HumanMessage(text)]
    reply = capture.run_agent(
        ctx,
        resolved,
        system=system,
        messages=turn,
        tools=tools,
        on_text=lambda d: stream.text(_strip_marks(d)),
        max_turns=MAX_STEPS,
        max_tool_calls=MAX_TOOL_CALLS,
        hooks=stream,
    )
    answer = plain_text(reply)
    unbacked = unbacked_claim(text, answer, stream.steps)
    if unbacked or promised(answer):
        # One corrective pass: told plainly that nothing was saved, or that
        # part of the ask was only promised.
        nudge = (NUDGE if unbacked else FINISH_NUDGE).format(text=text)
        stream.end_text()
        reply = capture.run_agent(
            ctx,
            resolved,
            system=system,
            messages=[
                *turn,
                AIMessage(_with_done(reply, stream.steps)),
                HumanMessage(nudge),
            ],
            # The corrective pass may need a tool this turn's words missed.
            tools=every,
            on_text=lambda d: stream.text(_strip_marks(d)),
            max_turns=MAX_STEPS,
            max_tool_calls=MAX_TOOL_CALLS,
            hooks=stream,
        )
        answer = plain_text(reply)
        if unbacked_claim(text, answer, stream.steps):
            answer = NOT_RECORDED
    if _ABOUT_NUTRITION.search(text) and not any(
        b["t"] == "nutrition" for b in run.blocks
    ):
        # Asked about the day's food and answered from memory: the card
        # still shows, since a model copying its earlier replies may skip
        # the tool that draws it.
        run.block({"t": "nutrition", "day": ctx.today.isoformat()})
    cap_id = capture.finish_chat_capture(ctx, wrun, reply=answer)
    steps = stream.steps_block()
    blocks = ([steps] if steps else []) + list(run.blocks)
    out = _message(ctx, "sol", answer or None, blocks, sol_id)
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
