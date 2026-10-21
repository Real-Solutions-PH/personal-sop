"""The capture AI path: a LangGraph tool-calling agent whose tools turn what
the user said into record cards (ADR-0012, ADR-0013).

The graph is two nodes, ``model`` and ``tools``, looping until the model
stops calling tools or :data:`MAX_TURNS` is reached. The ``tools`` node runs
calls one after another on the request's database session: LangGraph's
prebuilt ``ToolNode`` may run a turn's calls on parallel threads, which a
SQLAlchemy session does not survive.

Tools never write a module directly. Each one builds a draft exactly like
the rules parser would, :mod:`cards` tiers it, saves the auto-tier ones and
logs every write, so an AI write is undoable the same way as a rules write.
"""

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_core.tools import BaseTool, StructuredTool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field, ValidationError

from app.modules.ai_providers import public as ai
from app.modules.capture import cards as C
from app.modules.capture import ports, qa, seams
from app.modules.capture.models import Capture
from app.modules.capture.parse import (
    RecordDraft,
    World,
    habit_create_draft,
    meal_label,
)
from app.shared.context import Ctx
from app.shared.currency import money
from app.shared.money import MAX_MINOR

MAX_TURNS = 6
# Bounds on what one model call is sent. A tool result past MAX_TOOL_RESULT_CHARS
# is cut (the model sees that it was); calls past MAX_TOOL_CALLS_PER_TURN in one
# turn are answered with an error instead of run, so a runaway turn cannot grow
# the next call's input without limit.
MAX_TOOL_RESULT_CHARS = 2000
MAX_TOOL_CALLS_PER_TURN = 8
Emit = Callable[[str, dict[str, Any]], None]


# ---------------------------------------------------------------- the loop


class LoopState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    turns: int


def _text(msg: BaseMessage) -> str:
    return seams.text_of(msg)


def _stream_usage(chunks_usage: list[dict[str, Any]]) -> dict[str, Any] | None:
    """One call's usage from its streamed chunks: the largest figure each
    chunk reported, never their sum. Providers differ: OpenAI reports usage
    once at the end, some OpenAI-compatible servers (Nebius Token Factory)
    repeat the running total on every chunk, and Anthropic reports input at
    the start and output at the end. ``AIMessageChunk.__add__`` sums them,
    which for a running total meters a 7k-token call as 228k."""
    if not chunks_usage:
        return None
    i = max(int(u.get("input_tokens") or 0) for u in chunks_usage)
    o = max(int(u.get("output_tokens") or 0) for u in chunks_usage)
    return {"input_tokens": i, "output_tokens": o, "total_tokens": i + o}


def _tool_content(result: Any) -> str:
    text = result if isinstance(result, str) else json.dumps(result, default=str)
    if len(text) <= MAX_TOOL_RESULT_CHARS:
        return text
    return text[:MAX_TOOL_RESULT_CHARS] + " …[cut: result too long]"


def run_loop(
    ctx: Ctx,
    resolved: ai.ResolvedModel,
    *,
    system: str,
    messages: list[BaseMessage],
    tools: list[BaseTool],
    on_text: Callable[[str], None],
    max_turns: int = MAX_TURNS,
) -> str:
    """Run the model/tools graph; returns the model's final text. Every
    model call is metered; a provider failure raises ``SeamError``."""
    model = ai.build_chat_model(resolved)
    bound = model.bind_tools(tools) if tools else model
    by_name = {t.name: t for t in tools}

    def call_model(state: LoopState) -> dict[str, Any]:
        acc: BaseMessage | None = None
        usages: list[dict[str, Any]] = []
        try:
            for chunk in bound.stream([SystemMessage(system), *state["messages"]]):
                delta = _text(chunk)
                if delta:
                    on_text(delta)
                u = getattr(chunk, "usage_metadata", None)
                if u:
                    usages.append(dict(u))
                acc = chunk if acc is None else acc + chunk  # type: ignore[assignment]
        except Exception:  # noqa: BLE001 - a provider error becomes a stable code
            seams.meter(ctx, resolved, None, ok=False)
            raise seams.SeamError("model_unavailable") from None
        if isinstance(acc, AIMessageChunk):
            msg: BaseMessage = AIMessage(
                content=acc.content,
                tool_calls=acc.tool_calls,
                usage_metadata=_stream_usage(usages),
                id=acc.id,
            )
        else:
            msg = acc or AIMessage(content="")
        seams.meter(ctx, resolved, msg)
        return {"messages": [msg], "turns": state["turns"] + 1}

    def call_tools(state: LoopState) -> dict[str, Any]:
        last = state["messages"][-1]
        out: list[BaseMessage] = []
        for n, tc in enumerate(getattr(last, "tool_calls", None) or []):
            tool = by_name.get(tc["name"])
            if n >= MAX_TOOL_CALLS_PER_TURN:
                result: Any = {"error": "too_many_calls_in_one_turn"}
            elif tool is None:
                result = {"error": "unknown_tool"}
            else:
                try:
                    result = tool.invoke(tc["args"])
                except ValidationError:
                    result = {"error": "invalid_arguments"}
                except seams.SeamError as exc:
                    result = {"error": exc.code}
            out.append(
                ToolMessage(
                    content=_tool_content(result),
                    tool_call_id=tc.get("id") or str(uuid.uuid4()),
                    name=tc["name"],
                )
            )
        return {"messages": out}

    def route(state: LoopState) -> str:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None) and state["turns"] < max_turns:
            return "tools"
        return END

    g: StateGraph[LoopState] = StateGraph(LoopState)
    g.add_node("model", call_model)
    g.add_node("tools", call_tools)
    g.set_entry_point("model")
    g.add_conditional_edges("model", route, {"tools": "tools", END: END})
    g.add_edge("tools", "model")
    start: LoopState = {"messages": messages, "turns": 0}
    final = g.compile().invoke(start, {"recursion_limit": max_turns * 2 + 2})  # type: ignore[call-overload]
    last = final["messages"][-1]
    return _text(last) if isinstance(last, AIMessage) else ""


# ---------------------------------------------------------------- tools

# An amount in the user's currency (major units); stored as hundredths.
Amount = Annotated[float, Field(gt=0, le=MAX_MINOR / 100)]
DaysAgo = Annotated[int, Field(ge=0, le=366)]
Opt = Annotated[str, Field(max_length=120)] | None


class ExpenseArgs(BaseModel):
    amount: Amount
    category: Opt = None
    account: Opt = None
    payee: Opt = None
    note: Opt = None
    days_ago: DaysAgo = 0


class IncomeArgs(BaseModel):
    amount: Amount
    category: Opt = None
    account: Opt = None
    payee: Opt = None
    days_ago: DaysAgo = 0


class TransferArgs(BaseModel):
    amount: Amount
    from_account: Opt = None
    to_account: Opt = None


class PlannedArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    amount: Amount
    day_of_month: Annotated[int, Field(ge=1, le=31)]
    account: Opt = None
    category: Opt = None


class TaskIn(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=280)]
    due_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    due_time: Annotated[str, Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")] | None = None
    remind: bool = False


class TasksArgs(BaseModel):
    tasks: list[TaskIn] = Field(min_length=1, max_length=20)


class QueryArgs(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=200)]


class HabitLogArgs(BaseModel):
    habit: Annotated[str, Field(min_length=1, max_length=80)]
    value: Annotated[float, Field(ge=0, le=100000)] | None = None
    days_ago: DaysAgo = 0


class HabitCreateArgs(BaseModel):
    spec: Annotated[str, Field(min_length=1, max_length=200)] = Field(
        description="The habit as the user said it, e.g. 'read 20 min every weekday 9pm'"
    )


class SetArgs(BaseModel):
    reps: Annotated[int, Field(ge=0, le=1000)]
    weight: Annotated[float, Field(ge=0, le=2000)] = 0


class ExArgs(BaseModel):
    exercise: Annotated[str, Field(min_length=1, max_length=80)]
    sets: list[SetArgs] = Field(max_length=50)


class CardioArgs(BaseModel):
    activity: Literal["Run", "Walk", "Ride", "Swim", "Hike"] = "Run"
    km: Annotated[float, Field(ge=0, le=1000)] | None = None
    minutes: Annotated[float, Field(ge=0, le=1440)] | None = None


class WorkoutArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    exercises: list[ExArgs] = Field(default_factory=list, max_length=40)
    cardio: CardioArgs | None = None
    days_ago: DaysAgo = 0


class WeighArgs(BaseModel):
    kg: Annotated[float, Field(gt=20, le=500)]


class MealItemArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    qty: Annotated[float, Field(ge=0, le=10000)] = 1
    unit: Annotated[str, Field(max_length=24)] = "serving"
    kcal: Annotated[float, Field(ge=0, le=20000)]
    protein: Annotated[float, Field(ge=0, le=2000)] = 0
    carbs: Annotated[float, Field(ge=0, le=2000)] = 0
    fat: Annotated[float, Field(ge=0, le=2000)] = 0


class MealArgs(BaseModel):
    description: Annotated[str, Field(min_length=1, max_length=500)]
    items: list[MealItemArgs] | None = Field(default=None, max_length=30)
    confidence: Annotated[float, Field(ge=0, le=1)] = 0.6
    days_ago: DaysAgo = 0


class JournalArgs(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=20000)]
    mood: Annotated[int, Field(ge=1, le=5)] | None = None
    area: (
        Literal["identity", "career", "health", "money", "relationships", "growth"]
        | None
    ) = None
    tags: list[Annotated[str, Field(max_length=40)]] = Field(
        default_factory=list, max_length=10
    )


class EditLastArgs(BaseModel):
    amount: Amount


class NoArgs(BaseModel):
    pass


class LookupArgs(BaseModel):
    question: Annotated[str, Field(min_length=1, max_length=300)]


class OverviewArgs(BaseModel):
    days: Annotated[int, Field(ge=1, le=366)] = 30


@dataclass
class Run:
    """One capture's agent run: where cards land and how they stream."""

    ctx: Ctx
    cap: Capture
    world: World
    emit: Emit
    journal_in_qa: bool
    position: int = 0
    made: list[uuid.UUID] = field(default_factory=list)

    def next_position(self) -> int:
        p = self.position
        self.position += 1
        return p


def _minor(amount: float) -> int:
    return round(amount * 100)


def _offset(days_ago: int) -> int:
    return -days_ago


def _account_id(run: Run, hint: str | None, *, default: bool) -> str | None:
    if hint:
        a = ports.finance.find_account(run.ctx, hint)
        if a is not None:
            return str(a.id)
    return run.world.default_account if default else None


def _category_id(
    run: Run, hint: str | None, kind: Literal["expense", "income"]
) -> str | None:
    if not hint:
        return None
    c = ports.finance.resolve_category(run.ctx, hint, kind=kind)
    return str(c.id) if c else None


def _card(run: Run, d: RecordDraft) -> dict[str, Any]:
    from app.modules.capture import engine

    card = C.new_card(run.ctx, run.cap, d, position=run.next_position())
    if card.tier == "auto" and card.state == "proposed":
        C.save(run.ctx, card, run.cap, actor="ai")
    run.made.append(card.id)
    engine.emit_card(run.ctx, run.emit, card)
    return {
        "card_id": str(card.id),
        "state": card.state,
        "tier": card.tier,
        "warn": card.warn,
    }


def capture_tools(run: Run) -> list[BaseTool]:
    w = run.world

    def log_expense(**kw: Any) -> dict[str, Any]:
        a = ExpenseArgs(**kw)
        cat = _category_id(run, a.category, "expense")
        d = RecordDraft(
            kind="expense",
            target="finance",
            rule="expense",
            day_offset=_offset(a.days_ago),
            payload={
                k: v
                for k, v in {
                    "kind": "expense",
                    "amount_minor": _minor(a.amount),
                    "category_id": cat,
                    "account_id": _account_id(run, a.account, default=True),
                    "payee": a.payee,
                    "note": a.note,
                }.items()
                if v is not None
            },
            ask=None
            if cat
            else {
                "question": f"What was {money(_minor(a.amount), w.currency)} for?",
                "field": "category_id",
                "free": True,
                "options": list(w.recent_cats),
            },
        )
        return _card(run, d)

    def log_income(**kw: Any) -> dict[str, Any]:
        a = IncomeArgs(**kw)
        acct = _account_id(run, a.account, default=False)
        d = RecordDraft(
            kind="income",
            target="finance",
            rule="income",
            day_offset=_offset(a.days_ago),
            payload={
                k: v
                for k, v in {
                    "kind": "income",
                    "amount_minor": _minor(a.amount),
                    "category_id": _category_id(run, a.category, "income"),
                    "account_id": acct,
                    "payee": a.payee,
                }.items()
                if v is not None
            },
            ask=None
            if acct
            else {
                "question": f"Which account did the {money(_minor(a.amount), w.currency)} land in?",
                "field": "account_id",
                "options": list(w.account_options),
            },
        )
        return _card(run, d)

    def log_transfer(**kw: Any) -> dict[str, Any]:
        a = TransferArgs(**kw)
        frm = _account_id(run, a.from_account, default=False)
        to = _account_id(run, a.to_account, default=False)
        ask = None
        if not frm:
            ask = {
                "question": f"Moved {money(_minor(a.amount), w.currency)} from which account?",
                "field": "from",
                "options": [o for o in w.account_options if o["value"] != to],
            }
        elif not to:
            ask = {
                "question": "To which account?",
                "field": "to",
                "options": [o for o in w.account_options if o["value"] != frm],
            }
        payload = {
            "kind": "transfer",
            "amount_minor": _minor(a.amount),
            "from": frm,
            "to": to,
        }
        d = RecordDraft(
            kind="transfer",
            target="finance",
            rule="transfer",
            payload={k: v for k, v in payload.items() if v is not None},
            ask=ask,
        )
        return _card(run, d)

    def add_planned(**kw: Any) -> dict[str, Any]:
        a = PlannedArgs(**kw)
        payload = {
            "kind": "planned",
            "name": a.name,
            "amount_minor": _minor(a.amount),
            "day": a.day_of_month,
            "account_id": _account_id(run, a.account, default=True),
            "category_id": _category_id(run, a.category, "expense"),
        }
        d = RecordDraft(
            kind="planned",
            target="finance",
            rule="structure",
            confirm=True,
            payload={k: v for k, v in payload.items() if v is not None},
        )
        return _card(run, d)

    def create_tasks(**kw: Any) -> dict[str, Any]:
        a = TasksArgs(**kw)
        tasks = [
            {
                "title": t.title,
                "list_id": None,
                "due_date": t.due_date,
                "due_time": t.due_time,
                "remind": t.remind,
            }
            for t in a.tasks
        ]
        d = RecordDraft(
            kind="task",
            target="tasks",
            rule="reminder" if any(t["remind"] for t in tasks) else "task",
            payload={"kind": "task", "tasks": tasks},
        )
        return _card(run, d)

    def complete_task(**kw: Any) -> dict[str, Any]:
        a = QueryArgs(**kw)
        hits = ports.tasks.find_open_tasks(run.ctx, a.query, limit=5)
        if not hits:
            return {"error": "no_open_task_matches"}
        d = RecordDraft(
            kind="taskComplete",
            target="tasks",
            rule="task",
            payload={
                k: v
                for k, v in {
                    "kind": "taskComplete",
                    "task_id": str(hits[0].id) if len(hits) == 1 else None,
                    "query": a.query,
                }.items()
                if v is not None
            },
            ask={
                "question": "Which one did you finish?",
                "field": "task_id",
                "options": [{"label": t.title, "value": str(t.id)} for t in hits],
            }
            if len(hits) > 1
            else None,
        )
        return _card(run, d)

    def log_habit(**kw: Any) -> dict[str, Any]:
        a = HabitLogArgs(**kw)
        hits = ports.habits.find_habits(run.ctx, a.habit, limit=1)
        if not hits:
            d = habit_create_draft(a.habit, True)
            d.warn = f"No habit called “{a.habit}” yet — create it and check today?"
            return _card(run, d)
        h = hits[0]
        payload: dict[str, Any] = {"kind": "habitLog", "habit_id": str(h.id)}
        value = (
            a.value
            if a.value is not None
            else (h.target if h.type != "check" else None)
        )
        if value is not None:
            payload["value"] = value
        payload["add"] = h.type == "count" and a.value is not None
        d = RecordDraft(
            kind="habitLog",
            target="habits",
            rule="habit",
            day_offset=_offset(a.days_ago),
            payload=payload,
        )
        return _card(run, d)

    def create_habit(**kw: Any) -> dict[str, Any]:
        return _card(run, habit_create_draft(HabitCreateArgs(**kw).spec))

    def start_routine(**kw: Any) -> dict[str, Any]:
        a = QueryArgs(**kw)
        hits = ports.habits.find_routines(run.ctx, a.query, limit=5)
        d = RecordDraft(
            kind="routineStart",
            target="habits",
            rule="structure",
            confirm=True,
            payload={
                k: v
                for k, v in {
                    "kind": "routineStart",
                    "routine_id": str(hits[0].id) if len(hits) == 1 else None,
                    "query": a.query,
                }.items()
                if v is not None
            },
            ask=None
            if len(hits) == 1
            else {
                "question": "Which routine?",
                "field": "routine_id",
                "options": [
                    {"label": f"{r.icon} {r.name}", "value": r.id}
                    for r in w.routines
                    if r.status == "active"
                ],
            },
        )
        return _card(run, d)

    def log_workout(**kw: Any) -> dict[str, Any]:
        a = WorkoutArgs(**kw)
        payload: dict[str, Any] = {
            "kind": "workout",
            "name": a.name,
            "exercises": [
                {"exercise": e.exercise, "sets": [s.model_dump() for s in e.sets]}
                for e in a.exercises
            ],
        }
        if a.cardio is not None:
            payload["cardio"] = {
                k: v
                for k, v in {
                    "km": a.cardio.km,
                    "min": a.cardio.minutes,
                    "activity": a.cardio.activity,
                }.items()
                if v is not None
            }
        d = RecordDraft(
            kind="workout",
            target="fitness",
            rule="workout",
            day_offset=_offset(a.days_ago),
            payload=payload,
        )
        return _card(run, d)

    def log_weigh_in(**kw: Any) -> dict[str, Any]:
        a = WeighArgs(**kw)
        prev = w.latest_kg
        off = abs(a.kg - prev) / prev if prev else 0
        d = RecordDraft(
            kind="weighIn",
            target="fitness",
            rule="weighIn",
            confirm=off > 0.03,
            warn=f"That's {off * 100:.1f}% off your last weigh-in ({prev} kg) — typo?"
            if off > 0.03
            else None,
            payload={
                k: v
                for k, v in {"kind": "weighIn", "kg": a.kg, "prev_kg": prev}.items()
                if v is not None
            },
        )
        return _card(run, d)

    def log_meal(**kw: Any) -> dict[str, Any]:
        a = MealArgs(**kw)
        if a.items:
            items = [i.model_dump() for i in a.items]
            confidence = a.confidence
        else:
            est = ports.meal_estimate(run.ctx, a.description)
            if est is None:
                return {"error": "meal_not_recognised_send_items"}
            items, confidence = est.items, est.confidence
        d = RecordDraft(
            kind="meal",
            target="fitness",
            rule="meal",
            confirm=confidence < 0.7,
            confidence=confidence,
            day_offset=_offset(a.days_ago),
            payload={
                k: v
                for k, v in {
                    "kind": "meal",
                    "raw": a.description,
                    "label": meal_label(a.description),
                    "items": items,
                    "confidence": confidence,
                }.items()
                if v is not None
            },
        )
        return _card(run, d)

    def save_journal(**kw: Any) -> dict[str, Any]:
        a = JournalArgs(**kw)
        payload = {
            "kind": "journal",
            "body": a.body,
            "mood": a.mood,
            "area": a.area,
            "tags": a.tags,
            "transcript": run.cap.transcript if run.cap.source == "voice" else None,
        }
        d = RecordDraft(
            kind="journal",
            target="journal",
            rule="journal",
            payload={k: v for k, v in payload.items() if v is not None},
        )
        return _card(run, d)

    def edit_last(**kw: Any) -> dict[str, Any]:
        a = EditLastArgs(**kw)
        d = RecordDraft(
            kind="command",
            target="finance",
            rule="structure",
            confirm=True,
            payload={"kind": "command", "op": "edit", "amount_minor": _minor(a.amount)},
        )
        return _card(run, d)

    def delete_last(**kw: Any) -> dict[str, Any]:
        NoArgs(**kw)
        d = RecordDraft(
            kind="command",
            target="finance",
            rule="structure",
            confirm=True,
            payload={"kind": "command", "op": "delete"},
        )
        return _card(run, d)

    def lookup(**kw: Any) -> dict[str, Any]:
        from app.modules.capture import engine

        a = LookupArgs(**kw)
        body = qa.answer(run.ctx, a.question, journal_in_qa=run.journal_in_qa)
        engine.emit_reply(
            run.ctx, run.emit, run.cap, body, position=run.next_position()
        )
        return {
            k: body.get(k)
            for k in ("title", "value", "sub", "basis", "body")
            if body.get(k)
        }

    def stats_overview(**kw: Any) -> dict[str, Any]:
        a = OverviewArgs(**kw)
        try:
            o = ports.stats.overview(run.ctx, days=a.days)
        except NotImplementedError:
            return {"error": "stats_unavailable"}
        return {
            "life_score": o.life_score,
            "level": o.level,
            "delta": o.delta,
            "streak": o.streak,
            "areas": [
                {"module": x.module, "rate": x.rate} for x in o.areas if x.enabled
            ],
            "today": {"due": o.today_due, "done": o.today_done},
        }

    specs: list[tuple[Callable[..., Any], type[BaseModel], str]] = [
        (log_expense, ExpenseArgs, "Log money spent. One call per expense."),
        (
            log_income,
            IncomeArgs,
            "Log money received (salary, client payment, refund).",
        ),
        (
            log_transfer,
            TransferArgs,
            "Log money moved between two of the user's accounts.",
        ),
        (add_planned, PlannedArgs, "Add a monthly bill or planned payment."),
        (
            create_tasks,
            TasksArgs,
            "Create to-dos or reminders (one call, several tasks).",
        ),
        (
            complete_task,
            QueryArgs,
            "Mark an open task done, found by words in its title.",
        ),
        (
            log_habit,
            HabitLogArgs,
            "Check off a habit for a day (e.g. meditated 10 min).",
        ),
        (create_habit, HabitCreateArgs, "Create a new habit the user asked for."),
        (start_routine, QueryArgs, "Start one of the user's routines."),
        (log_workout, WorkoutArgs, "Log a finished workout: strength sets or cardio."),
        (log_weigh_in, WeighArgs, "Log a body-weight reading in kilograms."),
        (
            log_meal,
            MealArgs,
            "Log a meal; give items with macros when you can estimate them.",
        ),
        (save_journal, JournalArgs, "Save a reflective journal entry (private)."),
        (edit_last, EditLastArgs, "Change the amount of the most recent entry."),
        (delete_last, NoArgs, "Delete (undo) the most recent entry."),
        (
            lookup,
            LookupArgs,
            "Answer a question about the user's own data with a card.",
        ),
        (stats_overview, OverviewArgs, "The user's Life Score and area rates."),
    ]
    return [
        StructuredTool.from_function(
            func=fn, name=fn.__name__, description=desc, args_schema=schema
        )
        for fn, schema, desc in specs
    ]


SYSTEM = """You are the capture assistant of Personal SOP, a life-logging app.
The user writes or says loose notes in English, Filipino or Taglish. Turn each
fact into exactly one tool call; one message can hold several facts. Questions
about their own data go to `lookup`. Never invent amounts, dates or names the
user did not give. Amounts are in {currency}. Today is {today} ({zone}).
After the tools, reply with one short sentence; do not repeat the cards."""


def run_capture_agent(
    ctx: Ctx,
    cap: Capture,
    resolved: ai.ResolvedModel,
    *,
    world: World,
    emit: Emit,
    text: str,
    journal_in_qa: bool,
    start: int = 0,
) -> tuple[str, Run]:
    run = Run(
        ctx=ctx,
        cap=cap,
        world=world,
        emit=emit,
        journal_in_qa=journal_in_qa,
        position=start,
    )
    day = ctx.clock.day_of(cap.at)
    system = SYSTEM.format(
        today=day.isoformat(), zone=ctx.clock.zone, currency=ctx.currency.phrase
    )
    if day != ctx.today:
        system += (
            f"\nThis note was written on {day.isoformat()}; 'today' means that day."
        )
    reply = run_loop(
        ctx,
        resolved,
        system=system,
        messages=[HumanMessage(text)],
        tools=capture_tools(run),
        on_text=lambda t: emit("text.delta", {"text": t}),
    )
    return reply, run
