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
import re
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
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
from pydantic import BaseModel, BeforeValidator, Field, ValidationError

from app.modules.ai_providers import public as ai
from app.modules.capture import cards as C
from app.modules.capture import fitness_tools, ports, qa, seams
from app.modules.capture.models import Capture, RecordCard
from app.modules.capture.parse import (
    RecordDraft,
    World,
    habit_create_draft,
    meal_label,
)
from app.modules.iam.deps import release_connection
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
    calls: int


class LoopHooks:
    """What a caller hears while the loop runs, beyond the text stream (the
    companion turns these into AG-UI step and tool events). Every hook is
    optional; the defaults do nothing."""

    def model_started(self, turn: int) -> None:
        return None

    def model_finished(self, turn: int, message: BaseMessage) -> None:
        return None

    def tool_started(self, call_id: str, name: str, args: dict[str, Any]) -> None:
        return None

    def tool_finished(self, call_id: str, name: str, result: Any) -> None:
        return None

    def stopped(self) -> bool:
        """The person asked this reply to stop: the loop ends at its next
        step, keeping what it already did."""
        return False


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
    max_tool_calls: int | None = None,
    hooks: LoopHooks | None = None,
) -> str:
    """Run the model/tools graph; returns the model's final text. Every
    model call is metered; a provider failure raises ``SeamError``.

    ``max_tool_calls`` caps the tool calls of the whole run (past it a call
    is answered with an error instead of run); ``hooks`` hears each model
    call and tool call as it starts and ends."""
    h = hooks or LoopHooks()
    model = ai.build_chat_model(resolved)
    bound = model.bind_tools(tools) if tools else model
    by_name = {t.name: t for t in tools}

    def call_model(state: LoopState) -> dict[str, Any]:
        h.model_started(state["turns"] + 1)
        # A model call can think for minutes. Any read before it left the
        # session's connection checked out, idle in transaction, for all of
        # that time, so a few overlapping replies starved the pool for every
        # other request. Hand it back now; the next query checks one out.
        # Not inside a batch or a savepoint: committing there would end the
        # caller's all-or-nothing unit (capture interprets in a savepoint).
        if not ctx.in_batch and not ctx.session.in_nested_transaction():
            release_connection(ctx.session)
        acc: BaseMessage | None = None
        usages: list[dict[str, Any]] = []
        try:
            for chunk in bound.stream([SystemMessage(system), *state["messages"]]):
                if h.stopped():
                    break
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
                # A stopped call's half-written tool calls never run.
                tool_calls=[] if h.stopped() else acc.tool_calls,
                usage_metadata=_stream_usage(usages),
                id=acc.id,
            )
        else:
            msg = acc or AIMessage(content="")
        seams.meter(ctx, resolved, msg)
        h.model_finished(state["turns"] + 1, msg)
        return {"messages": [msg], "turns": state["turns"] + 1}

    def call_tools(state: LoopState) -> dict[str, Any]:
        last = state["messages"][-1]
        out: list[BaseMessage] = []
        calls = state.get("calls", 0)
        for n, tc in enumerate(getattr(last, "tool_calls", None) or []):
            tool = by_name.get(tc["name"])
            call_id = tc.get("id") or str(uuid.uuid4())
            args = tc.get("args") or {}
            h.tool_started(call_id, tc["name"], args)
            if h.stopped():
                result: Any = {"error": "stopped_by_the_person"}
            elif n >= MAX_TOOL_CALLS_PER_TURN:
                result = {"error": "too_many_calls_in_one_turn"}
            elif max_tool_calls is not None and calls >= max_tool_calls:
                result = {"error": "too_many_calls_in_this_reply"}
            elif tool is None:
                result = {"error": "unknown_tool"}
            else:
                try:
                    result = tool.invoke(tc["args"])
                except ValidationError:
                    result = {"error": "invalid_arguments"}
                except seams.SeamError as exc:
                    result = {"error": exc.code}
                calls += 1
            h.tool_finished(call_id, tc["name"], result)
            out.append(
                ToolMessage(
                    content=_tool_content(result),
                    tool_call_id=call_id,
                    name=tc["name"],
                )
            )
        return {"messages": out, "calls": calls}

    def route(state: LoopState) -> str:
        last = state["messages"][-1]
        if (
            getattr(last, "tool_calls", None)
            and state["turns"] < max_turns
            and not h.stopped()
        ):
            return "tools"
        return END

    g: StateGraph[LoopState] = StateGraph(LoopState)
    g.add_node("model", call_model)
    g.add_node("tools", call_tools)
    g.set_entry_point("model")
    g.add_conditional_edges("model", route, {"tools": "tools", END: END})
    g.add_edge("tools", "model")
    start: LoopState = {"messages": messages, "turns": 0, "calls": 0}
    final = g.compile().invoke(start, {"recursion_limit": max_turns * 2 + 2})  # type: ignore[call-overload]
    last = final["messages"][-1]
    return _text(last) if isinstance(last, AIMessage) else ""


# ---------------------------------------------------------------- tools

# An amount in the user's currency (major units); stored as hundredths.
Amount = Annotated[float, Field(gt=0, le=MAX_MINOR / 100)]
DaysAgo = Annotated[int, Field(ge=0, le=366)]
Opt = Annotated[str, Field(max_length=120)] | None


def _currency_code(v: Any) -> str | None:
    """A currency as a model may write it ("USD", "usd", "$", "dollars",
    "PHP (₱)") to a code; the user's own currency is left to the tool."""
    if v is None:
        return None
    text = str(v).strip()
    if not text:
        return None
    head = text.split()[0].strip("()").upper()
    if len(head) == 3 and head.isalpha():
        return head
    low = text.lower()
    if "$" in low or "dollar" in low:
        return "USD"
    if "€" in low or "euro" in low:
        return "EUR"
    if "₱" in low or "peso" in low:
        return "PHP"
    raise ValueError("currency must be a 3-letter code such as USD")


Currency = Annotated[
    str | None,
    BeforeValidator(_currency_code),
    Field(
        default=None,
        description="Only when the person said the amount in another "
        "currency: its ISO code, e.g. USD for $20 or 20 dollars. The amount "
        "stays exactly as they said it (20, not its peso value); the app "
        "converts it at today's rate. Omit for their own currency.",
    ),
]


class ExpenseArgs(BaseModel):
    amount: Amount
    currency: Currency = None
    category: Opt = Field(
        default=None,
        description="One of the person's expense categories that fits what "
        "it was for (a snack is Food, a gift or condolence is Gifts if they "
        "have it). Pick one whenever they said what it was for.",
    )
    account: Opt = None
    payee: Opt = None
    note: Opt = Field(
        default=None, description="What it was for, in their words, when they said."
    )
    days_ago: DaysAgo = 0


class IncomeArgs(BaseModel):
    amount: Amount
    currency: Currency = None
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
    due_date: date | None = Field(
        default=None,
        description="YYYY-MM-DD for a ONE-TIME payment due on that date (a "
        "bill, an instalment, a statement). Each instalment of a pay-later "
        "plan is its own call with its own due date.",
    )
    day_of_month: Annotated[int, Field(ge=1, le=31)] | None = Field(
        default=None,
        description="Only for something that REPEATS every month on this day "
        "(rent, a subscription). Never together with due_date.",
    )
    type: Literal["expense", "income"] = Field(
        default="expense", description="income for expected money in (salary)."
    )
    account: Opt = None
    category: Opt = None


# A task's labels ("work", "errand"); a name, as TaskEditArgs has a field
# called `list`.
TagList = list[Annotated[str, Field(min_length=1, max_length=40)]]


class TaskIn(BaseModel):
    title: Annotated[str, Field(min_length=1, max_length=280)]
    due_date: (
        Annotated[
            str,
            Field(
                pattern=r"^\d{4}-\d{2}-\d{2}$",
                description="Only when the user named a day; otherwise omit.",
            ),
        ]
        | None
    ) = None
    due_time: (
        Annotated[
            str,
            Field(
                pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
                description="Only when the user named a time; otherwise omit.",
            ),
        ]
        | None
    ) = None
    remind: bool = False
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(
        default_factory=list,
        max_length=8,
        description="Labels the person gave (work, errand); otherwise omit.",
    )
    list: (
        Annotated[
            str,
            Field(
                min_length=1,
                max_length=60,
                description=(
                    "Name of one of the person's task lists, only when they "
                    "named it or the task clearly belongs to exactly one "
                    "list; otherwise omit."
                ),
            ),
        ]
        | None
    ) = None


class TasksArgs(BaseModel):
    tasks: list[TaskIn] = Field(min_length=1, max_length=20)


class QueryArgs(BaseModel):
    query: Annotated[str, Field(min_length=1, max_length=200)]


class HabitLogArgs(BaseModel):
    habit: Annotated[str, Field(min_length=1, max_length=80)]
    value: Annotated[float, Field(ge=0, le=100000)] | None = None
    days_ago: DaysAgo = 0


Weekday = Literal["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
WEEKDAYS: tuple[str, ...] = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
Clock = Annotated[
    str,
    Field(
        pattern=r"^([01]\d|2[0-3]):[0-5]\d$",
        description="HH:MM, 24h. Only when the user named a time.",
    ),
]
Days = list[Weekday] | None
DAYS_DOC = "Days it is due; omit for every day."


class HabitCreateArgs(BaseModel):
    spec: Annotated[str, Field(min_length=1, max_length=200)] | None = Field(
        default=None,
        description="The habit as the user said it, e.g. 'read 20 min every weekday 9pm'",
    )
    name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    icon: Annotated[str, Field(min_length=1, max_length=8)] | None = Field(
        default=None, description="One emoji."
    )
    type: Literal["check", "duration", "count"] | None = Field(
        default=None,
        description="check (done or not), duration (minutes) or count (a number).",
    )
    target: Annotated[float, Field(gt=0, le=100000)] | None = Field(
        default=None, description="Minutes for duration, the number for count."
    )
    unit: Annotated[str, Field(min_length=1, max_length=16)] | None = Field(
        default=None, description="What a count counts: glasses, pages, reps."
    )
    days: Days = Field(default=None, description=DAYS_DOC)
    time: Clock | None = None


class AccountArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    type: Literal["cash", "bank", "ewallet", "credit", "investment"] = Field(
        description="ewallet for GCash, Maya and the like; credit for a credit card."
    )
    opening_balance: Annotated[
        float, Field(ge=-MAX_MINOR / 100, le=MAX_MINOR / 100)
    ] = Field(
        default=0,
        description="What is in it today, in the user's currency. For a "
        "credit card, what is owed, as a negative number. 0 when not given.",
    )
    credit_limit: Amount | None = Field(
        default=None, description="Credit cards only, when the user gave it."
    )


class BalanceArgs(BaseModel):
    account: Annotated[str, Field(min_length=1, max_length=60)] = Field(
        description="The existing account, by its name as the user has it."
    )
    balance: Annotated[float, Field(ge=-MAX_MINOR / 100, le=MAX_MINOR / 100)] | None = (
        Field(
            default=None,
            description="What is in it now, in the user's currency, when they "
            "say what it holds. For a credit card, what is owed, as a negative "
            "number. Leave out when they add to or take from it.",
        )
    )
    change: Annotated[float, Field(ge=-MAX_MINOR / 100, le=MAX_MINOR / 100)] | None = (
        Field(
            default=None,
            description="How much to add to what it holds now (negative to take "
            'away), when they say "add 100 to BDO" or "take 50 from cash". '
            "Leave out when they say what it holds.",
        )
    )


class BudgetArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    monthly_limit: Amount
    categories: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(
        default_factory=list,
        max_length=30,
        description="Expense categories it covers, by name; empty covers all spending.",
    )


# The account colours in the brand's order (``acct-*``), as the app stores
# them on the wire: the bare name.
ACCOUNT_COLORS = (
    "blue",
    "emerald",
    "violet",
    "orange",
    "cyan",
    "rose",
    "green",
    "red",
    "slate",
)


def _next_account_color(accounts: Sequence[Any]) -> str:
    """The first account colour none of the live accounts uses, else the
    next one round the palette, so a new account Fern adds is not drawn in
    the server's colourless default."""
    live = [a for a in accounts if not getattr(a, "archived", False)]
    used = {
        str(a.color or "").removeprefix("var(--acct-").removesuffix(")") for a in live
    }
    return next(
        (c for c in ACCOUNT_COLORS if c not in used),
        ACCOUNT_COLORS[len(live) % len(ACCOUNT_COLORS)],
    )


def _one_emoji(s: str) -> bool:
    """A single emoji (one grapheme: a base pictograph with any variation
    selectors, skin tones, keycaps or zero-width joins), not text such as
    ``tag``, which every picker would show as the word."""
    s = s.strip()
    if not s or (
        "\u20e3" not in s and any(ch.isalnum() and ord(ch) < 0x2000 for ch in s)
    ):
        return False
    joiners = {0x200D, 0xFE0F, 0xFE0E, 0x20E3}
    bases = [
        ch
        for ch in s
        if ord(ch) not in joiners
        and not 0x1F3FB <= ord(ch) <= 0x1F3FF  # skin tones
        and not 0xE0020 <= ord(ch) <= 0xE007F  # tag sequences (flags)
    ]
    flags = all(0x1F1E6 <= ord(ch) <= 0x1F1FF for ch in bases)
    zwj = s.count("\u200d")
    return bool(bases) and ((flags and len(bases) == 2) or len(bases) == zwj + 1)


class CategoryArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    kind: Literal["expense", "income"] = Field(
        default="expense",
        description="income for money coming in (a new kind of pay); "
        "expense otherwise. A sub-category takes its parent's kind.",
    )
    parent: Annotated[str, Field(min_length=1, max_length=60)] | None = Field(
        default=None,
        description="The existing main category it goes under, by name, "
        "when the user asked for a sub-category (e.g. 'Mobile plan' under "
        "'Bills'). Leave out for a main category.",
    )
    icon: Annotated[str, Field(min_length=1, max_length=8)] | None = Field(
        default=None, description="One emoji that fits it, e.g. 🐶 for Pets."
    )


class StepArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    minutes: Annotated[int, Field(ge=1, le=600)]


class RoutineArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    icon: Annotated[str, Field(min_length=1, max_length=8)] | None = Field(
        default=None, description="One emoji."
    )
    steps: list[StepArgs] = Field(
        min_length=1,
        max_length=30,
        description="In order. A step reuses the user's habit of that name, "
        "or a new habit is made for it.",
    )
    days: Days = Field(default=None, description=DAYS_DOC)
    time: Clock | None = None


class RoutineUpdateArgs(BaseModel):
    routine: Annotated[str, Field(min_length=1, max_length=80)] = Field(
        description="The routine to change, by its current name."
    )
    new_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    icon: Annotated[str, Field(min_length=1, max_length=8)] | None = Field(
        default=None, description="One emoji."
    )
    steps: list[StepArgs] | None = Field(
        default=None,
        max_length=30,
        description="Only when the steps change: the WHOLE new list in order, "
        "including the steps that stay. A step reuses the user's habit of that "
        "name, or a new habit is made for it.",
    )
    days: Days = Field(default=None, description="Only when the days change.")
    time: Clock | None = Field(
        default=None, description="HH:MM, 24h. Only when the time changes."
    )


class HabitUpdateArgs(BaseModel):
    habit: Annotated[str, Field(min_length=1, max_length=80)] = Field(
        description="The habit to change, by its current name."
    )
    new_name: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    icon: Annotated[str, Field(min_length=1, max_length=8)] | None = Field(
        default=None, description="One emoji."
    )
    target: Annotated[float, Field(gt=0, le=100000)] | None = Field(
        default=None, description="New minutes for duration, number for count."
    )
    unit: Annotated[str, Field(min_length=1, max_length=16)] | None = None
    days: Days = Field(default=None, description="Only when the days change.")
    time: Clock | None = Field(
        default=None, description="HH:MM, 24h. Only when the time changes."
    )


class TemplateExArgs(BaseModel):
    exercise: Annotated[str, Field(min_length=1, max_length=80)]
    sets: Annotated[int, Field(ge=1, le=20)] = 3
    reps: Annotated[int, Field(ge=1, le=100)] | None = None


class TemplateArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=80)]
    exercises: list[TemplateExArgs] = Field(min_length=1, max_length=40)


class ListArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=60)]
    shopping: bool = Field(
        default=False, description="True for a shopping or grocery list."
    )
    items: list[Annotated[str, Field(min_length=1, max_length=280)]] = Field(
        default_factory=list, max_length=50, description="Items to put in it now."
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
    """Weight, body fat, or both. Body fat alone reuses today's weight."""

    kg: Annotated[float | None, Field(gt=20, le=500)] = None
    body_fat_pct: Annotated[float | None, Field(gt=0, lt=100)] = None


class MealItemArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=120)]
    qty: Annotated[float, Field(ge=0, le=10000)] = 1
    unit: Annotated[str, Field(max_length=24)] = "serving"
    kcal: Annotated[float, Field(ge=0, le=20000)]
    protein: Annotated[float, Field(ge=0, le=2000)] = 0
    carbs: Annotated[float, Field(ge=0, le=2000)] = 0
    fat: Annotated[float, Field(ge=0, le=2000)] = 0
    fiber: Annotated[float, Field(ge=0, le=2000)] | None = None
    sat_fat: Annotated[float, Field(ge=0, le=2000)] | None = None
    sugar: Annotated[float, Field(ge=0, le=2000)] | None = Field(
        default=None, description=fitness_tools.SUGAR_SAYS
    )
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description=fitness_tools.SODIUM_SAYS
    )
    grams: Annotated[float, Field(gt=0, le=5000)] | None = Field(
        default=None,
        description="Edible grams this amount weighs (no bone or shell). "
        "Required for estimates.",
    )
    assumption: Annotated[str, Field(max_length=120)] | None = Field(
        default=None,
        description="The portion you assumed, e.g. 'breast quarter with skin'.",
    )
    alcohol: Annotated[float, Field(ge=0, le=500)] | None = Field(
        default=None, description="Grams of alcohol, for drinks that have it."
    )


# Checked on the way in, never stored on the item itself.
_CHECK_ONLY = ("grams", "alcohol")


def _stored_item(i: MealItemArgs) -> dict[str, Any]:
    """The item as saved: its weight goes into the assumption shown with it."""
    it = i.model_dump(exclude_none=True, exclude=set(_CHECK_ONLY))
    if i.grams:
        weight = f"about {i.grams:g} g"
        it["assumption"] = f"{i.assumption}, {weight}" if i.assumption else weight
    return it


class MealArgs(BaseModel):
    description: Annotated[str, Field(min_length=1, max_length=500)]
    items: list[MealItemArgs] | None = Field(default=None, max_length=30)
    confidence: Annotated[float, Field(ge=0, le=1)] = 0.6
    days_ago: DaysAgo = 0
    eaten_again: bool = Field(
        default=False,
        description="true only when the person ate a second breakfast, lunch "
        "or dinner that day; otherwise change the saved one with edit_meal.",
    )


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
    cap: Capture | None
    world: World
    emit: Emit
    journal_in_qa: bool
    position: int = 0
    made: list[uuid.UUID] = field(default_factory=list)
    # A chat turn opens its capture on the first write, so a reply that only
    # answers leaves no capture behind (ADR-0015).
    open_cap: Callable[[], Capture] | None = None
    # The person's own words this run answers. A task keeps a date or time
    # only when these name one; empty means no check.
    said: str = ""

    def capture(self) -> Capture:
        if self.cap is None:
            if self.open_cap is None:
                raise RuntimeError("run has no capture")
            self.cap = self.open_cap()
        return self.cap

    def next_position(self) -> int:
        p = self.position
        self.position += 1
        return p


# Days and times in the person's words (English or Filipino). A task keeps
# the date or time the model gives only when these name one: without them the
# model invents "today 23:59". "last Saturday" is the past, not a due date.
_PAST = re.compile(r"\b(last|past|previous|nakaraang)\s+\w+|\b\w+\s+ago\b", re.I)
_NAMES_DAY = re.compile(
    r"\b(today|tonight|tomorrow|tmrw|yesterday|weekend|week|month|next|"
    r"later|asap|eod|deadline|due|before|until|"
    r"mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rs|rsday)?|fri(day)?|"
    r"sat(urday)?|sun(day)?|jan(uary)?|feb(ruary)?|march|apr(il)?|june?|"
    r"july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?|"
    r"bukas|mamaya|ngayon|lunes|martes|miyerkules|huwebes|biyernes|sabado|"
    r"linggo)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}\b"
    r"|\bin \d+\s*(days?|weeks?)\b",
    re.I,
)
_NAMES_TIME = re.compile(
    r"\b(tonight|morning|afternoon|evening|noon|midnight|eod|umaga|tanghali|"
    r"hapon|gabi|mamaya)\b|\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)"
    r"|\b\d{1,2}:\d{2}\b|\bin \d+\s*(min|mins|minutes|hr|hrs|hours?)\b",
    re.I,
)


# ------------------------------------------------- changing what exists

Ids = Annotated[
    list[Annotated[str, Field(max_length=40)]], Field(min_length=1, max_length=60)
]


class FindTxArgs(BaseModel):
    query: Opt = Field(
        default=None,
        description="Words in the payee, note or category, or an amount. Omit "
        "to list the latest ones.",
    )
    days: Annotated[int, Field(ge=1, le=400)] = 30


class TxEditArgs(BaseModel):
    ids: Ids = Field(description="Transaction ids from find_transactions.")
    amount: Amount | None = None
    category: Opt = None
    account: Opt = Field(default=None, description="Move it to this account.")
    payee: Opt = None
    note: Opt = None
    day: date | None = Field(default=None, description="The day it happened.")
    type: Literal["expense", "income"] | None = None


class ListScheduledArgs(BaseModel):
    account: Opt = Field(
        default=None, description="Only the ones paid from or into this account."
    )


class ScheduledEditArgs(BaseModel):
    ids: Ids | None = Field(
        default=None, description="Scheduled item ids from list_scheduled."
    )
    from_account: Opt = Field(
        default=None,
        description="Instead of ids: every scheduled item on this account "
        '("move all from Maya Black to Maya Savings").',
    )
    name: Opt = None
    amount: Amount | None = None
    account: Opt = Field(default=None, description="The account it moves to.")
    day_of_month: Annotated[int, Field(ge=1, le=31)] | None = Field(
        default=None, description="Make it repeat monthly on this day."
    )
    due_date: date | None = Field(
        default=None, description="Make it a one-time payment due that day."
    )
    type: Literal["expense", "income"] | None = None
    category: Opt = None


class AccountEditArgs(BaseModel):
    account: Annotated[str, Field(min_length=1, max_length=120)]
    new_name: Opt = None
    type: Literal["cash", "bank", "ewallet", "credit", "investment"] | None = Field(
        default=None, description="credit for a credit card; investment for savings."
    )
    credit_limit: Amount | None = None


class BudgetEditArgs(BaseModel):
    budget: Annotated[str, Field(min_length=1, max_length=120)]
    monthly_limit: Amount | None = None
    new_name: Opt = None


class TaskEditArgs(BaseModel):
    task: Annotated[str, Field(min_length=1, max_length=280)] = Field(
        description="Words from the task's title."
    )
    new_title: Opt = None
    due_date: date | None = None
    notes: Annotated[str, Field(max_length=2000)] | None = None
    list: Opt = None
    tags: TagList | None = Field(
        default=None,
        max_length=8,
        description="The task's whole new set of tags ([] clears them).",
    )


RemoveWhat = Literal[
    "transaction",
    "scheduled",
    "account",
    "budget",
    "task",
    "habit",
    "routine",
    "meal",
    "weigh_in",
    "workout",
    "exercise",
    "template",
    "food",
]


class RemoveArgs(BaseModel):
    what: RemoveWhat
    ids: Ids | None = Field(
        default=None,
        description="Ids from find_transactions, list_scheduled or find_fitness_logs.",
    )
    name: Opt = Field(
        default=None,
        description="Instead of ids: the account, budget, task, habit, "
        "routine, exercise, template or saved food's name.",
    )


class FoodArgs(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=160)] = Field(
        description="The food as it should be found again (brand and product "
        "for packaged food, e.g. 'Lucky Me Pancit Canton Original')."
    )
    basis: Literal["100g", "piece", "serving"] = Field(
        description="What the numbers are for: per 100 g, per piece, or per "
        "serving as the label states."
    )
    unit_grams: Annotated[float, Field(gt=0, le=5000)] | None = Field(
        default=None, description="Grams in one piece or serving, when known."
    )
    kcal: Annotated[float, Field(ge=0, le=20000)]
    protein: Annotated[float, Field(ge=0, le=2000)] = 0
    carbs: Annotated[float, Field(ge=0, le=2000)] = 0
    fat: Annotated[float, Field(ge=0, le=2000)] = 0
    fiber: Annotated[float, Field(ge=0, le=2000)] | None = None
    sat_fat: Annotated[float, Field(ge=0, le=2000)] | None = None
    sugar: Annotated[float, Field(ge=0, le=2000)] | None = Field(
        default=None, description="Added sugar in grams (total if not split)."
    )
    sodium: Annotated[float, Field(ge=0, le=100000)] | None = Field(
        default=None, description="milligrams"
    )
    state: Literal["raw", "cooked", "as_sold"] | None = None
    aliases: list[Annotated[str, Field(max_length=80)]] = Field(
        default_factory=list,
        max_length=10,
        description="Other names they call it ('pancit canton', 'lucky me').",
    )
    source: Literal["label", "said"] = Field(
        default="said",
        description="label when read from a nutrition label (photo or typed "
        "from one); said when they gave the numbers otherwise.",
    )


class FindFoodArgs(BaseModel):
    query: Opt = Field(
        default=None, description="Words of the food's name; omit to list."
    )


def names_day(text: str) -> bool:
    """Whether the person's words give a day (a due date)."""
    return bool(_NAMES_DAY.search(_PAST.sub(" ", text)))


def names_time(text: str) -> bool:
    """Whether the person's words give a time of day."""
    return bool(_NAMES_TIME.search(_PAST.sub(" ", text)))


def _minor(amount: float) -> int:
    return round(amount * 100)


def _routine_named(run: Run, name: str) -> Any:
    """The user's active routine with this name (any case), else the best
    match the routine search gives."""
    hits = [
        r
        for r in ports.habits.find_routines(run.ctx, name, limit=5)
        if r.status == "active"
    ]
    exact = next((r for r in hits if r.name.lower() == name.lower()), None)
    return exact or (hits[0] if hits else None)


def _habit_named(run: Run, name: str) -> Any:
    """The user's active habit with exactly this name (any case)."""
    return next(
        (
            h
            for h in ports.habits.find_habits(run.ctx, name, limit=5)
            if h.name.lower() == name.lower()
        ),
        None,
    )


def _days(days: Days) -> list[int] | None:
    """Weekday names to the habits module's numbers (0 = Sunday)."""
    return sorted({WEEKDAYS.index(d) for d in days}) if days else None


def _offset(days_ago: int) -> int:
    return -days_ago


def _with_converted(
    out: dict[str, Any], fx: dict[str, Any], cur: Any
) -> dict[str, Any]:
    """Tell the model (and the step row) what a foreign amount came to."""
    if fx:
        out["converted"] = money(int(fx["amount_minor"]), cur)
        out["rate"] = fx["fx_rate"]
    return out


def _foreign(run: Run, amount: float, code: str | None) -> dict[str, Any]:
    """An amount said in another currency: the converted ``amount_minor``
    and the fx fields the card carries; ``{}`` for the user's own currency,
    ``{"error": ...}`` when today's rate can't be had."""
    from fastapi import HTTPException

    if code is None or code == run.ctx.currency.code:
        return {}
    orig = _minor(amount)
    try:
        rate = ports.finance.fx_rate(run.ctx, code)
    except HTTPException:
        return {
            "error": "exchange_rate_unavailable",
            "instead": "ask for the amount in their own currency",
        }
    return {
        "amount_minor": ports.finance.convert(orig, rate),
        "orig_currency": code,
        "orig_amount_minor": orig,
        "fx_rate": str(rate),
    }


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


def _card(run: Run, d: RecordDraft, *, setup: bool = False) -> dict[str, Any]:
    """Make the draft's card and save it when its tier allows.

    ``setup`` is a request to set something up by name (a habit, an account,
    a routine, a template, a budget, a list): the person asked for exactly
    this, and its card has Undo, so it is saved now instead of waiting on the
    "structure" rule's Confirm."""
    from app.modules.capture import engine

    cap = run.capture()
    card = C.new_card(run.ctx, cap, d, position=run.next_position())
    if setup and card.tier == "confirm" and card.state == "proposed":
        card.tier = "auto"
    if card.tier == "auto" and card.state == "proposed":
        C.save(run.ctx, card, cap, actor="ai")
    run.made.append(card.id)
    engine.emit_card(run.ctx, run.emit, card)
    out: dict[str, Any] = {
        "card_id": str(card.id),
        "capture_id": str(card.capture_id),
        "state": card.state,
        "tier": card.tier,
        "warn": card.warn,
    }
    if card.state == "needs_input" and card.ask:
        # Ask it: the card can't be confirmed until this is answered.
        out["question"] = card.ask.get("question")
    return out


_MAIN_MEALS = ("breakfast", "lunch", "dinner")


def _waiting(run: Run) -> list[RecordCard]:
    from app.modules.capture import public

    return public.waiting_chat_cards(run.ctx)


def _same_meal(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Two versions of one meal: a food in common, by name or by the
    numbers (a food renamed between versions keeps its kcal)."""

    def foods(p: dict[str, Any]) -> list[dict[str, Any]]:
        return [i for i in (p.get("items") or []) if isinstance(i, dict)]

    names = {str(i.get("name", "")).strip().lower() for i in foods(a)}
    if names & {str(i.get("name", "")).strip().lower() for i in foods(b)} - {""}:
        return True
    kcal_a = sorted(round(float(i.get("kcal") or 0)) for i in foods(a))
    kcal_b = sorted(round(float(i.get("kcal") or 0)) for i in foods(b))
    return bool(kcal_a) and kcal_a == kcal_b


def _withdraw_earlier_versions(run: Run, d: RecordDraft, keep: str) -> int:
    """A breakfast, lunch or dinner logged again for the same day replaces
    the version still waiting for the person's OK. Seen live: four waiting
    versions of one breakfast piled up, and confirming them all saved a
    stale one with the old food names."""
    label = d.payload.get("label")
    if label not in _MAIN_MEALS:
        return 0
    n = 0
    for card in _waiting(run):
        p = card.payload or {}
        if (
            str(card.id) != keep
            and card.kind == "meal"
            and p.get("label") == label
            and (card.day_offset or 0) == (d.day_offset or 0)
            and _same_meal(p, d.payload)
        ):
            C.discard_row(run.ctx, card)
            n += 1
    return n


def _waiting_expense(run: Run, d: RecordDraft) -> RecordCard | None:
    """The same expense (amount, payee, day) still waiting from an earlier
    message. Seen live: the same bank screenshot sent twice made a second
    pair of waiting expenses, and confirming would have doubled them. Cards
    from this message are never matched: one receipt can hold two equal
    purchases."""
    p = d.payload
    payee = str(p.get("payee") or "").strip().lower()
    cap = run.capture().id
    for card in _waiting(run):
        q: dict[str, Any] = card.payload or {}
        if (
            card.capture_id != cap
            and q.get("kind") == "expense"
            and q.get("amount_minor") == p.get("amount_minor")
            and str(q.get("payee") or "").strip().lower() == payee
            and (card.day_offset or 0) == (d.day_offset or 0)
        ):
            return card
    return None


def _waiting_removal(run: Run, entity: str, ids: list[str]) -> RecordCard | None:
    want = set(ids)
    for card in _waiting(run):
        p: dict[str, Any] = card.payload or {}
        got = p.get("ids")
        if (
            card.kind == "remove"
            and p.get("entity") == entity
            and isinstance(got, list)
            and {str(i) for i in got} == want
        ):
            return card
    return None


def capture_tools(run: Run) -> list[BaseTool]:
    w = run.world

    def log_expense(**kw: Any) -> dict[str, Any]:
        a = ExpenseArgs(**kw)
        fx = _foreign(run, a.amount, a.currency)
        if "error" in fx:
            return fx
        cat = _category_id(run, a.category, "expense")
        if a.category and cat is None:
            # Seen live 2026-10-29: "pre-workout" and "condolence" matched no
            # category, so both expenses asked the person what they were for
            # though they had just said. The model picks one of theirs.
            return {
                "error": "unknown_category",
                "categories": [
                    c.name
                    for c in ports.finance.list_categories(run.ctx)
                    if c.kind == "expense" and not c.archived
                ],
                "instead": "call again with the closest of these categories, "
                "and put what it was for in note",
            }
        d = RecordDraft(
            kind="expense",
            target="finance",
            rule="expense",
            day_offset=_offset(a.days_ago),
            payload={
                k: v
                for k, v in {
                    "kind": "expense",
                    "amount_minor": fx.get("amount_minor") or _minor(a.amount),
                    **fx,
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
                "question": "What was "
                f"{money(fx.get('amount_minor') or _minor(a.amount), w.currency)} for?",
                "field": "category_id",
                "free": True,
                "options": list(w.recent_cats),
            },
        )
        same = _waiting_expense(run, d)
        if same is not None:
            return {
                "card_id": str(same.id),
                "state": same.state,
                "already_waiting": True,
                "question": (same.ask or {}).get("question"),
                "instead": "it's already logged and waiting; don't log it again",
            }
        return _with_converted(_card(run, d), fx, w.currency)

    def log_income(**kw: Any) -> dict[str, Any]:
        a = IncomeArgs(**kw)
        fx = _foreign(run, a.amount, a.currency)
        if "error" in fx:
            return fx
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
                    "amount_minor": fx.get("amount_minor") or _minor(a.amount),
                    **fx,
                    "category_id": _category_id(run, a.category, "income"),
                    "account_id": acct,
                    "payee": a.payee,
                }.items()
                if v is not None
            },
            ask=None
            if acct
            else {
                "question": "Which account did the "
                f"{money(fx.get('amount_minor') or _minor(a.amount), w.currency)} "
                "land in?",
                "field": "account_id",
                "options": list(w.account_options),
            },
        )
        return _with_converted(_card(run, d), fx, w.currency)

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
        if a.due_date is None and a.day_of_month is None:
            return {"error": "give_due_date_or_day_of_month"}
        if a.due_date is not None and a.due_date < run.ctx.today - timedelta(days=60):
            return {"error": "due_date_is_long_past", "today": str(run.ctx.today)}
        payload = {
            "kind": "planned",
            "name": a.name,
            "amount_minor": _minor(a.amount),
            "type": a.type if a.type != "expense" else None,
            # One-time on its date, else monthly on its day.
            "date": a.due_date.isoformat() if a.due_date else None,
            "day": None if a.due_date else a.day_of_month,
            "account_id": _account_id(run, a.account, default=True),
            # An income plan looks among income categories; looking among
            # expense ones saved every income plan with no category.
            "category_id": _category_id(run, a.category, a.type),
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
        # A date or time the person never gave is the model's invention.
        day = not run.said or names_day(run.said) or names_time(run.said)
        time = not run.said or names_time(run.said)
        # A named list files the task there; a name with no live list leaves
        # it in the Inbox and is reported back. Lists are never made here.
        unknown: list[str] = []
        tasks = []
        for t in a.tasks:
            lst = ports.tasks.find_active_list(run.ctx, t.list) if t.list else None
            if t.list and lst is None and t.list not in unknown:
                unknown.append(t.list)
            tasks.append(
                {
                    "title": t.title,
                    "list_id": str(lst.id) if lst else None,
                    "due_date": t.due_date if day else None,
                    "due_time": t.due_time if time else None,
                    "remind": t.remind,
                    "tags": list(t.tags),
                }
            )
        # Plain to-dos and reminders tier differently (a reminder waits for
        # the user's OK), so they become separate cards: one reminder in the
        # call must not hold the plain tasks back.
        groups = [
            ("task", [t for t in tasks if not t["remind"]]),
            ("reminder", [t for t in tasks if t["remind"]]),
        ]
        made = [
            {
                **_card(
                    run,
                    RecordDraft(
                        kind="task",
                        target="tasks",
                        rule=rule,
                        payload={"kind": "task", "tasks": group},
                    ),
                ),
                "titles": [t["title"] for t in group],
            }
            for rule, group in groups
            if group
        ]
        out = made[0] if len(made) == 1 else {"cards": made}
        if unknown:
            out["unknown_lists"] = unknown
        return out

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
        a = HabitCreateArgs(**kw)
        said = a.spec or a.name
        if not said:
            return {"error": "give_the_habit_a_name"}
        d = habit_create_draft(said)
        given = {
            "name": a.name,
            "icon": a.icon,
            "type": a.type,
            "target": a.target,
            "unit": a.unit,
            "days": _days(a.days),
            "time": a.time,
        }
        d.payload.update({k: v for k, v in given.items() if v is not None})
        if d.payload.get("type") == "check":
            d.payload.pop("target", None)
            d.payload.pop("unit", None)
        elif not d.payload.get("target"):
            return {"error": "duration_or_count_needs_a_target"}
        if _habit_named(run, str(d.payload["name"])) is not None:
            return {
                "error": "a_habit_with_that_name_exists",
                "instead": "update_habit, to change it",
            }
        return _card(run, d, setup=True)

    def create_account(**kw: Any) -> dict[str, Any]:
        a = AccountArgs(**kw)
        if any(
            x.name.lower() == a.name.lower()
            for x in ports.finance.list_accounts(run.ctx)
        ):
            return {
                "error": "an_account_with_that_name_exists",
                "instead": "set_account_balance, to set its balance",
            }
        if a.credit_limit is not None and a.type != "credit":
            return {"error": "only_a_credit_card_has_a_limit"}
        payload = {
            "kind": "accountCreate",
            "name": a.name,
            "color": _next_account_color(ports.finance.list_accounts(run.ctx)),
            "type": a.type,
            "opening_minor": _minor(a.opening_balance),
            "limit_minor": _minor(a.credit_limit) if a.credit_limit else None,
        }
        d = RecordDraft(
            kind="accountCreate",
            target="finance",
            rule="structure",
            payload={k: v for k, v in payload.items() if v is not None},
        )
        return _card(run, d, setup=True)

    # Accounts already changed by an amount this reply: a corrective pass
    # repeating the call must not add the amount twice.
    changed: set[str] = set()

    def set_account_balance(**kw: Any) -> dict[str, Any]:
        a = BalanceArgs(**kw)
        acc = ports.finance.find_account(run.ctx, a.account)
        if acc is None:
            return {
                "error": "no_account_with_that_name",
                "accounts": [x.name for x in ports.finance.list_accounts(run.ctx)],
            }
        if (a.balance is None) == (a.change is None):
            return {"error": "give_either_balance_or_change"}
        if a.change is not None and str(acc.id) in changed:
            return {"error": "already_changed_this_reply_send_one_combined_change"}
        # Seen live 2026-10-29: "add 100 to my BDO" set it to 100 instead of
        # adding to the 1 it held.
        balance_minor = (
            _minor(a.balance)
            if a.balance is not None
            else ports.finance.account_balance(run.ctx, account_id=acc.id)
            + _minor(a.change or 0)
        )
        d = RecordDraft(
            kind="accountBalance",
            target="finance",
            rule="structure",
            payload={
                "kind": "accountBalance",
                "account_id": str(acc.id),
                "name": acc.name,
                "balance_minor": balance_minor,
            },
        )
        out = {**_card(run, d, setup=True), "balance_minor": balance_minor}
        if a.change is not None:
            changed.add(str(acc.id))
        return out

    def create_budget(**kw: Any) -> dict[str, Any]:
        a = BudgetArgs(**kw)
        if ports.finance.find_budget(run.ctx, a.name) is not None:
            return {"error": "a_budget_with_that_name_exists"}
        ids: list[str] = []
        unknown: list[str] = []
        for name in a.categories:
            c = ports.finance.resolve_category(run.ctx, name, kind="expense")
            if c is None:
                unknown.append(name)
            elif str(c.id) not in ids:
                ids.append(str(c.id))
        if unknown:
            return {
                "error": "unknown_category",
                "unknown": unknown,
                "categories": [
                    c.name
                    for c in ports.finance.list_categories(run.ctx)
                    if c.kind == "expense" and not c.archived
                ],
            }
        d = RecordDraft(
            kind="budgetCreate",
            target="finance",
            rule="structure",
            payload={
                "kind": "budgetCreate",
                "name": a.name,
                "limit_minor": _minor(a.monthly_limit),
                "category_ids": ids,
                "categories": a.categories,
            },
        )
        return _card(run, d, setup=True)

    def create_category(**kw: Any) -> dict[str, Any]:
        a = CategoryArgs(**kw)
        name = " ".join(a.name.split())
        parent = None
        if a.parent:
            parent = ports.finance.main_category(run.ctx, a.parent)
            h = " ".join(a.parent.lower().split())
            if parent is None and any(
                c.parent_id is not None and " ".join(c.name.lower().split()) == h
                for c in ports.finance.list_categories(run.ctx)
            ):
                # The named parent is itself a sub-category.
                return {"error": "categories_nest_one_level"}
            if parent is None:
                return {
                    "error": "no_main_category_with_that_name",
                    "main_categories": [
                        c.name
                        for c in ports.finance.list_categories(run.ctx)
                        if c.parent_id is None and not c.system
                    ],
                }
        kind: Literal["expense", "income"] = (
            "income" if (parent.kind if parent else a.kind) == "income" else "expense"
        )
        if any(
            c.kind == kind
            and c.parent_id == (parent.id if parent else None)
            and c.name.lower() == name.lower()
            for c in ports.finance.list_categories(run.ctx)
        ):
            return {"error": "a_category_with_that_name_exists"}
        d = RecordDraft(
            kind="categoryCreate",
            target="finance",
            rule="structure",
            payload={
                k: v
                for k, v in {
                    "kind": "categoryCreate",
                    "name": name,
                    "category_kind": kind,
                    "parent_id": str(parent.id) if parent else None,
                    "parent_name": parent.name if parent else None,
                    "icon": a.icon
                    if a.icon and _one_emoji(a.icon)
                    else (parent.icon if parent else "🏷️"),
                    # A new expense counts as a want (it breaks a no-spend
                    # day), as the app's own editor starts it; a
                    # sub-category follows its parent.
                    "want": parent.discretionary if parent else kind == "expense",
                }.items()
                if v is not None
            },
        )
        return _card(run, d, setup=True)

    def create_routine(**kw: Any) -> dict[str, Any]:
        a = RoutineArgs(**kw)
        if any(
            r.name.lower() == a.name.lower() and r.status == "active"
            for r in w.routines
        ):
            return {
                "error": "a_routine_with_that_name_exists",
                "instead": "update_routine, to change it",
            }
        steps: list[dict[str, Any]] = []
        for st in a.steps:
            hit = _habit_named(run, st.name)
            steps.append(
                {"name": st.name, "minutes": st.minutes}
                | ({"habit_id": str(hit.id)} if hit else {})
            )
        payload = {
            "kind": "routineCreate",
            "name": a.name,
            "icon": a.icon,
            "steps": steps,
            "days": _days(a.days),
            "time": a.time,
        }
        d = RecordDraft(
            kind="routineCreate",
            target="habits",
            rule="structure",
            payload={k: v for k, v in payload.items() if v is not None},
        )
        out = _card(run, d, setup=True)
        return {
            **out,
            "new_habits": [s["name"] for s in steps if "habit_id" not in s],
        }

    def update_routine(**kw: Any) -> dict[str, Any]:
        a = RoutineUpdateArgs(**kw)
        target = _routine_named(run, a.routine)
        if target is None:
            return {
                "error": "no_routine_with_that_name",
                "routines": [r.name for r in w.routines if r.status == "active"],
            }
        if (
            a.new_name
            and a.new_name.lower() != target.name.lower()
            and any(
                r.name.lower() == a.new_name.lower() and r.status == "active"
                for r in w.routines
            )
        ):
            return {"error": "a_routine_with_that_name_exists"}
        steps: list[dict[str, Any]] | None = None
        if a.steps is not None:
            steps = []
            for st in a.steps:
                hit = _habit_named(run, st.name)
                steps.append(
                    {"name": st.name, "minutes": st.minutes}
                    | ({"habit_id": str(hit.id)} if hit else {})
                )
        payload = {
            "kind": "routineUpdate",
            "routine_id": str(target.id),
            "name": a.new_name or target.name,
            "new_name": a.new_name,
            "icon": a.icon,
            "steps": steps,
            "days": _days(a.days),
            "time": a.time,
        }
        if all(
            payload[k] is None for k in ("new_name", "icon", "steps", "days", "time")
        ):
            return {"error": "nothing_to_change"}
        d = RecordDraft(
            kind="routineUpdate",
            target="habits",
            rule="structure",
            payload={k: v for k, v in payload.items() if v is not None},
        )
        out = _card(run, d, setup=True)
        if steps is not None:
            out["new_habits"] = [s["name"] for s in steps if "habit_id" not in s]
        return out

    def update_habit(**kw: Any) -> dict[str, Any]:
        a = HabitUpdateArgs(**kw)
        target = _habit_named(run, a.habit) or next(
            iter(ports.habits.find_habits(run.ctx, a.habit, limit=1)), None
        )
        if target is None:
            return {"error": "no_habit_with_that_name"}
        payload = {
            "kind": "habitUpdate",
            "habit_id": str(target.id),
            "name": a.new_name or target.name,
            "new_name": a.new_name,
            "icon": a.icon,
            "target": a.target,
            "unit": a.unit,
            "days": _days(a.days),
            "time": a.time,
        }
        if all(
            payload[k] is None
            for k in ("new_name", "icon", "target", "unit", "days", "time")
        ):
            return {"error": "nothing_to_change"}
        d = RecordDraft(
            kind="habitUpdate",
            target="habits",
            rule="structure",
            payload={k: v for k, v in payload.items() if v is not None},
        )
        return _card(run, d, setup=True)

    def create_workout_template(**kw: Any) -> dict[str, Any]:
        a = TemplateArgs(**kw)
        if ports.fitness.find_template(run.ctx, a.name) is not None:
            return {"error": "a_template_with_that_name_exists"}
        d = RecordDraft(
            kind="templateCreate",
            target="fitness",
            rule="structure",
            payload={
                "kind": "templateCreate",
                "name": a.name,
                "exercises": [e.model_dump(exclude_none=True) for e in a.exercises],
            },
        )
        return _card(run, d, setup=True)

    def create_task_list(**kw: Any) -> dict[str, Any]:
        a = ListArgs(**kw)
        if ports.tasks.find_list(run.ctx, a.name) is not None:
            return {"error": "a_list_with_that_name_exists"}
        d = RecordDraft(
            kind="listCreate",
            target="tasks",
            rule="structure",
            payload={
                "kind": "listCreate",
                "name": a.name,
                "list_kind": "shopping" if a.shopping else "standard",
                "items": a.items,
            },
        )
        return _card(run, d, setup=True)

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
        kg = a.kg
        if kg is None:
            if a.body_fat_pct is None:
                return {"error": "give_weight_or_body_fat"}
            # Body fat alone rides on today's weigh-in; an older weight is
            # never stamped onto today.
            if prev is None or w.latest_kg_day != w.today:
                return {"error": "ask_for_todays_weight_with_body_fat"}
            kg = prev
        off = abs(kg - prev) / prev if prev else 0
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
                for k, v in {
                    "kind": "weighIn",
                    "kg": kg,
                    "body_fat_pct": a.body_fat_pct,
                    "prev_kg": prev,
                }.items()
                if v is not None
            },
        )
        return _card(run, d)

    def log_meal(**kw: Any) -> dict[str, Any]:
        a = MealArgs(**kw)
        if a.items:
            wrong = ports.meal_item_problems(
                run.ctx, [i.model_dump(exclude_none=True) for i in a.items]
            )
            if wrong:
                return {"error": "fix_these_items_then_call_again", "items": wrong}
            items = [_stored_item(i) for i in a.items]
            confidence = a.confidence
        else:
            est = ports.meal_estimate(run.ctx, a.description)
            if est is None:
                return {"error": "meal_not_recognised_send_items"}
            items, confidence = est.items, est.confidence
        # The person's own food library wins over any estimate; a meal made
        # only of library foods is known, not guessed.
        items, from_library = ports.library_items(run.ctx, items)
        if from_library and len(from_library) == len(items):
            confidence = max(confidence, 0.95)
        label = meal_label(a.description)
        # Seen live: a lunch retried after a refusal was logged a second time
        # on top of the saved one, counting its food twice.
        if label in _MAIN_MEALS and not a.eaten_again:
            day = run.ctx.today - timedelta(days=a.days_ago)
            saved = ports.saved_meal_with(run.ctx, label, day, items)
            if saved is not None:
                return {
                    "error": f"{label}_already_logged_today_change_it_with_edit_meal",
                    "meal_id": str(saved),
                }
        missing = ports.meal_missing_details(items)
        d = RecordDraft(
            kind="meal",
            target="fitness",
            rule="meal",
            confirm=confidence < 0.7,
            warn=missing,
            confidence=confidence,
            day_offset=_offset(a.days_ago),
            payload={
                k: v
                for k, v in {
                    "kind": "meal",
                    "raw": a.description,
                    "label": label,
                    "items": items,
                    "confidence": confidence,
                }.items()
                if v is not None
            },
        )
        out = _card(run, d)
        replaced = _withdraw_earlier_versions(run, d, out["card_id"])
        if replaced:
            out = out | {"replaced_waiting_versions": replaced}
        if missing:
            out = out | {"saved_without": missing}
        return out | ({"from_library": from_library} if from_library else {})

    def save_food(**kw: Any) -> dict[str, Any]:
        a = FoodArgs(**kw)
        if a.basis == "100g" and a.kcal > 900:
            return {"error": "more_than_900_kcal_per_100g_check_the_basis"}
        food, new = ports.fitness.food_library.save_food(
            run.ctx,
            ports.fitness.FoodDraft(
                name=a.name,
                kcal=a.kcal,
                protein=a.protein,
                carbs=a.carbs,
                fat=a.fat,
                fiber=a.fiber,
                sat_fat=a.sat_fat,
                sugar=a.sugar,
                sodium=a.sodium,
                basis=a.basis,
                unit_grams=a.unit_grams,
                state=a.state,
                aliases=list(a.aliases),
                source=a.source,
                verified=a.source == "label",
            ),
        )
        basis = {"100g": "per 100 g", "piece": "per piece", "serving": "per serving"}[
            a.basis
        ]
        return {
            "saved": food.name,
            "new": new,
            "summary": f"{'Saved' if new else 'Updated'} in your food library: "
            f"{food.name} · {round(a.kcal)} kcal {basis}",
        }

    def find_foods(**kw: Any) -> dict[str, Any]:
        a = FindFoodArgs(**kw)
        lib = ports.fitness.food_library
        return {
            "foods": [
                lib.food_public(f) for f in lib.search_foods(run.ctx, a.query or "")
            ]
        }

    def save_journal(**kw: Any) -> dict[str, Any]:
        a = JournalArgs(**kw)
        payload = {
            "kind": "journal",
            "body": a.body,
            "mood": a.mood,
            "area": a.area,
            "tags": a.tags,
            "transcript": (
                run.capture().transcript if run.capture().source == "voice" else None
            ),
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

    # ------------------------------------------- changing what exists

    def _manage(
        kind: Literal["edit", "remove"],
        entity: str,
        ids: list[str],
        name: str,
        changes: dict[str, Any] | None,
        target: str,
        summary: str,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "kind": kind,
            "entity": entity,
            "ids": ids,
            "name": name,
        }
        if changes is not None:
            payload["changes"] = changes
        d = RecordDraft(kind=kind, target=target, rule="structure", payload=payload)
        # An edit the person asked for saves now (it has Undo); a removal
        # waits for their Confirm.
        out = _card(run, d, setup=kind == "edit")
        return out | {"summary": summary}

    def _money(amount: float) -> str:
        return money(_minor(amount), w.currency)

    def find_transactions(**kw: Any) -> dict[str, Any]:
        a = FindTxArgs(**kw)
        accts = {x.id: x.name for x in ports.finance.list_accounts(run.ctx)}
        cats = {c.id: c.name for c in ports.finance.list_categories(run.ctx)}
        rows = ports.finance.find_records(run.ctx, query=a.query, days=a.days)
        return {
            "transactions": [
                {
                    "id": str(r.id),
                    "day": run.ctx.clock.day_of(r.at).isoformat(),
                    "type": r.type,
                    "amount": money(r.amount_minor, w.currency),
                    "payee": r.payee,
                    "note": r.note,
                    "category": cats.get(r.category_id) if r.category_id else None,
                    "account": accts.get(r.account_id),
                    "to_account": accts.get(r.to_account_id)
                    if r.to_account_id
                    else None,
                }
                for r in rows
            ]
        }

    def edit_transaction(**kw: Any) -> dict[str, Any]:
        a = TxEditArgs(**kw)
        changes: dict[str, Any] = {}
        if a.type:
            changes["type"] = a.type
        if a.amount is not None:
            changes["amount_minor"] = _minor(a.amount)
        if a.category:
            cat = _category_id(run, a.category, a.type or "expense")
            if cat is None:
                return {"error": "no_category_with_that_name"}
            changes["category_id"] = cat
        if a.account:
            acct = _account_id(run, a.account, default=False)
            if acct is None:
                return {"error": "no_account_with_that_name"}
            changes["account_id"] = acct
        if a.payee is not None:
            changes["payee"] = a.payee
        if a.note is not None:
            changes["note"] = a.note
        if a.day is not None:
            changes["at"] = run.ctx.clock.local_time(a.day, "12:00").isoformat()
        if not changes:
            return {"error": "nothing_to_change"}
        n = len(a.ids)
        return _manage(
            "edit",
            "record",
            list(a.ids),
            f"{n} transaction{'s' if n != 1 else ''}",
            changes,
            "finance",
            f"Changed {n} transaction{'s' if n != 1 else ''}",
        )

    def list_scheduled(**kw: Any) -> dict[str, Any]:
        a = ListScheduledArgs(**kw)
        accts = {x.id: x.name for x in ports.finance.list_accounts(run.ctx)}
        only = _account_id(run, a.account, default=False) if a.account else None
        if a.account and only is None:
            return {"error": "no_account_with_that_name"}
        items = [
            p
            for p in ports.finance.list_planned_items(run.ctx)
            if only is None or str(p.account_id) == only or str(p.to_account_id) == only
        ]
        return {
            "scheduled": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "type": p.type,
                    "amount": money(p.amount_minor, w.currency),
                    "account": accts.get(p.account_id),
                    "schedule": p.schedule,
                    "what_if": p.is_what_if,
                }
                for p in items
            ]
        }

    def edit_scheduled(**kw: Any) -> dict[str, Any]:
        a = ScheduledEditArgs(**kw)
        if a.ids:
            ids = list(a.ids)
        elif a.from_account:
            src = _account_id(run, a.from_account, default=False)
            if src is None:
                return {"error": "no_account_with_that_name"}
            ids = [
                str(p.id)
                for p in ports.finance.list_planned_items(run.ctx)
                if str(p.account_id) == src
            ]
            if not ids:
                return {"error": "nothing_scheduled_on_that_account"}
        else:
            return {"error": "say_which_items", "instead": "call list_scheduled"}
        if a.day_of_month and a.due_date:
            return {"error": "day_of_month_or_due_date_not_both"}
        changes: dict[str, Any] = {}
        if a.name:
            changes["name"] = a.name
        if a.amount is not None:
            changes["amount_minor"] = _minor(a.amount)
        if a.type:
            changes["type"] = a.type
        if a.account:
            dest = _account_id(run, a.account, default=False)
            if dest is None:
                return {"error": "no_account_with_that_name"}
            changes["account_id"] = dest
        if a.category:
            cat = _category_id(run, a.category, a.type or "expense")
            if cat is None:
                return {"error": "no_category_with_that_name"}
            changes["category_id"] = cat
        if a.day_of_month:
            changes["schedule"] = {"kind": "monthly", "day": a.day_of_month}
        if a.due_date:
            changes["schedule"] = {"kind": "once", "date": a.due_date.isoformat()}
            changes["start"] = a.due_date.isoformat()
        if not changes:
            return {"error": "nothing_to_change"}
        n = len(ids)
        what = f"{n} scheduled item{'s' if n != 1 else ''}"
        where = f" to {a.account}" if a.account else ""
        return _manage(
            "edit",
            "planned",
            ids,
            what,
            changes,
            "finance",
            f"{'Moved' if a.account else 'Changed'} {what}{where}",
        )

    def edit_account(**kw: Any) -> dict[str, Any]:
        a = AccountEditArgs(**kw)
        acc = ports.finance.find_account(run.ctx, a.account)
        if acc is None:
            return {"error": "no_account_with_that_name"}
        changes: dict[str, Any] = {}
        if a.new_name:
            changes["name"] = a.new_name
        if a.type:
            changes["type"] = a.type
        if a.credit_limit is not None:
            changes["limit_minor"] = _minor(a.credit_limit)
        if a.type and a.type != "credit" and acc.limit_minor is not None:
            changes["limit_minor"] = None
        if not changes:
            return {"error": "nothing_to_change"}
        return _manage(
            "edit",
            "account",
            [str(acc.id)],
            acc.name,
            changes,
            "finance",
            f"Changed account: {acc.name}",
        )

    def edit_budget(**kw: Any) -> dict[str, Any]:
        a = BudgetEditArgs(**kw)
        b = ports.finance.find_budget(run.ctx, a.budget)
        if b is None:
            return {
                "error": "no_budget_with_that_name",
                "budgets": [x.name for x in ports.finance.list_budgets(run.ctx)],
            }
        changes: dict[str, Any] = {}
        if a.monthly_limit is not None:
            changes["limit_minor"] = _minor(a.monthly_limit)
        if a.new_name:
            changes["name"] = a.new_name
        if not changes:
            return {"error": "nothing_to_change"}
        extra = f" · {_money(a.monthly_limit)} a month" if a.monthly_limit else ""
        return _manage(
            "edit",
            "budget",
            [str(b.id)],
            b.name,
            changes,
            "finance",
            f"Changed budget: {b.name}{extra}",
        )

    def edit_task(**kw: Any) -> dict[str, Any]:
        a = TaskEditArgs(**kw)
        hits = ports.tasks.find_open_tasks(run.ctx, a.task, limit=2)
        if not hits:
            return {"error": "no_open_task_like_that"}
        t = hits[0]
        changes: dict[str, Any] = {}
        if a.new_title:
            changes["title"] = a.new_title
        if a.notes is not None:
            changes["notes"] = a.notes
        if a.tags is not None:
            changes["tags"] = list(a.tags)
        if a.due_date:
            changes["due_date"] = a.due_date.isoformat()
        if a.list:
            lst = ports.tasks.find_list(run.ctx, a.list)
            if lst is None:
                return {"error": "no_list_with_that_name"}
            changes["list_id"] = str(lst.id)
        if not changes:
            return {"error": "nothing_to_change"}
        return _manage(
            "edit",
            "task",
            [str(t.id)],
            t.title,
            changes,
            "tasks",
            f"Changed task: {t.title}",
        )

    def remove_item(**kw: Any) -> dict[str, Any]:
        a = RemoveArgs(**kw)
        entity, target = {
            "transaction": ("record", "finance"),
            "scheduled": ("planned", "finance"),
            "account": ("account", "finance"),
            "budget": ("budget", "finance"),
            "task": ("task", "tasks"),
            "habit": ("habit", "habits"),
            "routine": ("routine", "habits"),
            "meal": ("meal", "fitness"),
            "weigh_in": ("weighIn", "fitness"),
            "workout": ("workout", "fitness"),
            "exercise": ("exercise", "fitness"),
            "template": ("template", "fitness"),
            "food": ("food", "fitness"),
        }[a.what]
        ids = list(a.ids or [])
        label = a.name or ""
        if not ids and a.name:
            hit: Any = None
            if a.what == "account":
                hit = ports.finance.find_account(run.ctx, a.name)
            elif a.what == "budget":
                hit = ports.finance.find_budget(run.ctx, a.name)
            elif a.what == "task":
                hit = next(
                    iter(ports.tasks.find_open_tasks(run.ctx, a.name, limit=1)), None
                )
            elif a.what == "habit":
                hit = _habit_named(run, a.name)
            elif a.what == "routine":
                hit = _routine_named(run, a.name)
            elif a.what in ("exercise", "template", "food"):
                found = fitness_tools.removal_target(run, a.what, a.name)
                if isinstance(found, dict):
                    return found
                ids, label = found
            if hit is not None:
                ids = [str(hit.id)]
                label = str(getattr(hit, "name", None) or getattr(hit, "title", ""))
        if not ids:
            return {"error": f"no_{a.what}_found", "instead": "look it up first"}
        n = len(ids)
        what = a.what.replace("_", "-")
        label = label or f"{n} {what}{'s' if n != 1 else ''}"
        verb = (
            "Archive"
            if entity
            in ("planned", "account", "budget", "habit", "routine", "exercise")
            else "Delete"
        )
        if entity == "meal" and not any(
            ports.fitness.meal_exists(run.ctx, i) for i in ids
        ):
            return {"error": "meal_already_deleted"}
        twin = _waiting_removal(run, entity, ids)
        if twin is not None:
            # Seen live: the same delete asked for twice, then the second
            # failed once the first had run. One request per entry.
            return {
                "card_id": str(twin.id),
                "state": twin.state,
                "already_waiting": True,
            }
        return _manage(
            "remove",
            entity,
            ids,
            label,
            None,
            target,
            f"{verb}: {label}",
        )

    def lookup(**kw: Any) -> dict[str, Any]:
        from app.modules.capture import engine

        a = LookupArgs(**kw)
        body = qa.answer(run.ctx, a.question, journal_in_qa=run.journal_in_qa)
        engine.emit_reply(
            run.ctx, run.emit, run.capture(), body, position=run.next_position()
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
        (
            add_planned,
            PlannedArgs,
            "Add a planned payment or expected income: one-time on a due date "
            "(a bill, an instalment) or monthly on a day (rent, a subscription).",
        ),
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
        (
            create_habit,
            HabitCreateArgs,
            "Create a new habit the user asked for. Give name, type, target, "
            "unit, days and time when they said them; spec alone also works.",
        ),
        (
            create_account,
            AccountArgs,
            "Add a money account (cash, bank, e-wallet, credit card, "
            "investment) with its balance today.",
        ),
        (
            set_account_balance,
            BalanceArgs,
            "Set what an account the user already has holds now: its "
            "starting or opening balance, or a corrected balance (e.g. 'Maya "
            "has 5,000', 'set the initial balance of BPI'). For an account "
            "that already exists; never create_account again for it.",
        ),
        (
            create_budget,
            BudgetArgs,
            "Set a monthly spending budget, for some expense categories or all.",
        ),
        (
            create_category,
            CategoryArgs,
            "Add a spending or income category the user asked for, or a "
            "sub-category under one of their main categories. For one that "
            "already exists, use it instead.",
        ),
        (
            update_routine,
            RoutineUpdateArgs,
            "Change a routine the user already has: rename it, change its "
            "days or time, or reorder, add or remove steps (send the whole new "
            "step list). Never create_routine again for an existing one.",
        ),
        (
            update_habit,
            HabitUpdateArgs,
            "Change a habit the user already has: rename it, change its target "
            "or unit, or its days or time.",
        ),
        (
            create_routine,
            RoutineArgs,
            "Create a routine: an ordered set of timed steps, e.g. a morning "
            "routine. Not for gym workouts.",
        ),
        (
            create_workout_template,
            TemplateArgs,
            "Create a workout template (a gym routine or plan) of exercises "
            "with sets; reps set a new exercise's rep range. Weights are not "
            "kept on a template.",
        ),
        (
            create_task_list,
            ListArgs,
            "Create a task list (e.g. Groceries), optionally with items in it.",
        ),
        (start_routine, QueryArgs, "Start one of the user's routines."),
        (log_workout, WorkoutArgs, "Log a finished workout: strength sets or cardio."),
        (
            log_weigh_in,
            WeighArgs,
            "Log a weigh-in: body weight in kilograms, body fat percent, or "
            "both in one call. Body fat alone is added to today's weight.",
        ),
        (
            log_meal,
            MealArgs,
            "Log a meal; give items with macros when you can estimate them.",
        ),
        (save_journal, JournalArgs, "Save a reflective journal entry (private)."),
        (
            save_food,
            FoodArgs,
            "Save a food's nutrition facts to the user's food library (from a "
            "label they photographed or typed, or numbers they gave), so every "
            "later meal with it uses these exact values. Updates the food if "
            "it is already there.",
        ),
        (
            find_foods,
            FindFoodArgs,
            "Look up foods in the user's own food library (their saved "
            "nutrition facts).",
        ),
        (
            find_transactions,
            FindTxArgs,
            "Find the user's past transactions (ids, day, amount, payee, "
            "category, account) to change or delete one.",
        ),
        (
            edit_transaction,
            TxEditArgs,
            "Change saved transactions: amount, category, account, payee, "
            "note, day or type. Get ids from find_transactions first.",
        ),
        (
            list_scheduled,
            ListScheduledArgs,
            "List scheduled (planned) income and bills with their account and "
            "schedule.",
        ),
        (
            edit_scheduled,
            ScheduledEditArgs,
            "Change scheduled income or bills: amount, name, account, monthly "
            "day or one-time due date. from_account changes every item on an "
            "account at once.",
        ),
        (
            edit_account,
            AccountEditArgs,
            "Rename an account, change its type (e.g. to credit card) or its "
            "credit limit.",
        ),
        (edit_budget, BudgetEditArgs, "Change a budget's monthly limit or name."),
        (
            edit_task,
            TaskEditArgs,
            "Change an open task: title, due date, notes or list.",
        ),
        (
            remove_item,
            RemoveArgs,
            "Delete a transaction, task, meal, weigh-in, workout, workout "
            "template or saved food, or archive a scheduled item, account, "
            "budget, habit, routine or exercise. Waits for the user's "
            "Confirm; Undo brings it back.",
        ),
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
    ] + fitness_tools.fitness_tools(run, manage=_manage, card=_card)


# The capture tools that answer rather than write; Fern has its own.
READ_TOOLS = frozenset({"lookup", "stats_overview"})
# Finders that only read, offered alongside the edits that need their ids.
FINDERS = frozenset(
    {"find_transactions", "list_scheduled", "find_fitness_logs", "find_foods"}
)


def write_tools(run: Run) -> list[BaseTool]:
    """The capture catalogue's writing tools, for an agent that brings its
    own read tools (Fern, ADR-0015). Every one lands as a card on
    ``run``'s capture, tiered and undoable."""
    return [t for t in capture_tools(run) if t.name not in READ_TOOLS]


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
        said=text,
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
