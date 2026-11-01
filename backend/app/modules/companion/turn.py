"""One Fern turn as AG-UI events (ADR-0015).

:class:`TurnStream` hears the agent loop (it is the loop's ``LoopHooks``) and
the tools' cards and blocks, and turns them into AG-UI events for the SSE
response: a step per model call and per tool, the reply text as it streams,
each tool call with its arguments and a one-line outcome, and the cards to
render. It also keeps the steps, so the stored reply can show what Fern did
after the stream is gone.

The labels and outcomes are written here, from the tool's arguments and
result, never by the model: what the person reads about a write is what was
written.
"""

import json
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from ag_ui.core import (
    BaseEvent,
    CustomEvent,
    ReasoningEndEvent,
    ReasoningMessageContentEvent,
    ReasoningMessageEndEvent,
    ReasoningMessageStartEvent,
    ReasoningStartEvent,
    RunErrorEvent,
    RunFinishedEvent,
    RunStartedEvent,
    StepFinishedEvent,
    StepStartedEvent,
    TextMessageContentEvent,
    TextMessageEndEvent,
    TextMessageStartEvent,
    ToolCallArgsEvent,
    ToolCallEndEvent,
    ToolCallResultEvent,
    ToolCallStartEvent,
)
from langchain_core.messages import BaseMessage

from app.modules.capture import public as capture
from app.modules.fitness import public as fitness
from app.shared.context import Ctx
from app.shared.currency import CODES, currency, money

Sink = Callable[[BaseEvent], None]

# What a running step says, per tool ("Adding a task…").
# Tools a turn calls once; a repeat returns the first answer (the tool
# enforces it) and draws no second step line.
# Tools that run once a turn. Seen live: confirm_pending called twice in
# one reply, each step listing the same refusals.
# How often a running reply asks whether it was told to stop.
STOP_CHECK_SECONDS = 0.3
# The model's thinking streams a word at a time; it goes out at most this
# often, gathered (the first piece at once).
REASONING_FLUSH_SECONDS = 0.25

ONCE_A_TURN = frozenset({"recall_memories", "confirm_pending", "discard_pending"})

RUNNING: dict[str, str] = {
    "create_tasks": "Adding to your tasks",
    "complete_task": "Marking a task done",
    "log_expense": "Logging an expense",
    "log_income": "Logging income",
    "log_transfer": "Logging a transfer",
    "add_planned": "Adding a planned payment",
    "log_habit": "Checking off a habit",
    "create_habit": "Creating a habit",
    "create_account": "Adding an account",
    "update_routine": "Changing a routine",
    "update_habit": "Changing a habit",
    "set_account_balance": "Setting a balance",
    "create_budget": "Setting a budget",
    "create_category": "Adding a category",
    "create_routine": "Creating a routine",
    "create_workout_template": "Creating a workout template",
    "create_task_list": "Creating a list",
    "start_routine": "Starting a routine",
    "log_workout": "Logging a workout",
    "log_weigh_in": "Logging your weight",
    "log_meal": "Logging a meal",
    "save_journal": "Saving to your journal",
    "edit_last": "Changing the last entry",
    "delete_last": "Removing the last entry",
    "lookup": "Looking it up",
    "query_records": "Reading your records",
    "stats_overview": "Checking your Life Score",
    "show_chart": "Drawing a chart",
    "show_insights": "Finding patterns",
    "coach": "Reviewing how you're doing",
    "plan_day": "Planning your day",
    "track": "Setting up tracking",
    "remember_fact": "Remembering that",
    "forget_fact": "Forgetting that",
    "show_memories": "Gathering what I remember",
    "recall_memories": "Recalling what I know",
    "reread_photos": "Reading the photos again",
    "suggest": "Suggesting next questions",
    "read_photos": "Looking at your photos",
    "web_search": "Searching the web",
    "nutrition_status": "Checking today's macros",
    "focus_status": "Checking your focus time",
    "start_focus": "Starting the focus timer",
    "focus_control": "Changing the focus timer",
    "stop_focus": "Stopping the focus timer",
    "find_transactions": "Finding transactions",
    "edit_transaction": "Changing transactions",
    "list_scheduled": "Checking scheduled payments",
    "edit_scheduled": "Changing scheduled payments",
    "edit_account": "Changing an account",
    "edit_budget": "Changing a budget",
    "edit_task": "Changing a task",
    "find_fitness_logs": "Finding your logs",
    "create_exercise": "Adding an exercise",
    "edit_exercise": "Changing an exercise",
    "edit_workout_template": "Changing a workout template",
    "start_workout": "Starting a workout",
    "edit_workout": "Changing a workout",
    "edit_meal": "Changing a meal",
    "copy_meal": "Logging that meal again",
    "edit_weigh_in": "Changing a weigh-in",
    "set_macro_target": "Changing your macro target",
    "fitness_settings": "Changing fitness settings",
    "edit_food": "Changing a saved food",
    "remove_item": "Removing it",
    "save_food": "Saving to your food library",
    "find_foods": "Checking your food library",
    "confirm_pending": "Saving what was waiting",
    "discard_pending": "Dropping what was waiting",
}


NOTHING_WAITING = "Nothing was waiting"


def _weigh(args: dict[str, Any]) -> str:
    kg, fat = args.get("kg"), args.get("body_fat_pct")
    parts = [f"{kg} kg" if kg else "", f"{fat}% body fat" if fat else ""]
    return "Logged " + ", ".join(p for p in parts if p)


def _when(t: dict[str, Any]) -> str:
    parts = [p for p in (t.get("due_date"), t.get("due_time")) if p]
    return f" · {' '.join(parts)}" if parts else ""


ALREADY_LOGGED = "_already_logged_today_change_it_with_edit_meal"


def refused(res: dict[str, Any]) -> str:
    """Why a write was refused, in words the person can act on. Seen live:
    "Couldn't finish: fix these items then call again" named neither the
    food nor what was wrong with it."""
    error = str(res["error"])
    items = res.get("items")
    if error == "fix_these_items_then_call_again" and isinstance(items, list):
        return f"Not saved: {fitness.nutrient_check.plain_items(items)}"
    if error.endswith(ALREADY_LOGGED):
        label = error.removesuffix(ALREADY_LOGGED)
        return f"{label.capitalize()} is already logged today, so it wasn't added again"
    if error == "not_saved" and res.get("why"):
        return f"Not saved: {res['why']}"
    return f"Couldn't finish: {error.replace('_', ' ')}"


def outcome(ctx: Ctx, name: str, args: dict[str, Any], result: Any) -> tuple[bool, str]:
    """``(ok, sentence)`` for a finished tool call, from its arguments and
    result. A write that waits for the person says so."""
    res = result if isinstance(result, dict) else {}
    if res.get("error") == "several_match":
        return False, "More than one matches; asking which"
    if res.get("error"):
        return False, refused(res)
    # A card with a question can't be confirmed until it's answered.
    wait = {
        "proposed": " (waiting for your OK)",
        "needs_input": f" ({res.get('question') or 'needs an answer'})",
    }.get(str(res.get("state")), "")
    if name == "create_tasks":
        tasks = args.get("tasks") or []
        if len(tasks) == 1:
            t = tasks[0]
            return True, f"Added task: {t.get('title', '')}{_when(t)}{wait}"
        titles = ", ".join(str(t.get("title", "")) for t in tasks[:3])
        more = f" and {len(tasks) - 3} more" if len(tasks) > 3 else ""
        if res.get("cards"):
            waiting_n = sum(
                1 for c in res["cards"] if c.get("state") in ("proposed", "needs_input")
            )
            note = f" ({waiting_n} waiting for your OK)" if waiting_n else ""
            return True, f"Added {len(tasks)} tasks: {titles}{more}{note}"
        return True, f"Added {len(tasks)} tasks: {titles}{more}{wait}"
    if res.get("summary"):
        # Changing what exists: the tool says what it did.
        return True, f"{res['summary']}{wait}"
    if name == "find_transactions":
        n = len(res.get("transactions") or [])
        return True, f"Found {n} transaction{'s' if n != 1 else ''}"
    if name == "list_scheduled":
        n = len(res.get("scheduled") or [])
        return True, f"Found {n} scheduled item{'s' if n != 1 else ''}"
    if name == "find_foods":
        n = len(res.get("foods") or [])
        return True, f"Found {n} food{'s' if n != 1 else ''} in your library"
    if name == "find_fitness_logs":
        if res.get("workout"):
            return True, f"Found workout: {res['workout'].get('name', '')}"
        key = next(
            (
                k
                for k in ("meals", "weigh_ins", "workouts", "exercises", "templates")
                if k in res
            ),
            "meals",
        )
        n = len(res.get(key) or [])
        noun = {"weigh_ins": "weigh-in", "meals": "meal"}.get(key, key[:-1])
        return True, f"Found {n} {noun}{'s' if n != 1 else ''}"
    if name in ("confirm_pending", "discard_pending"):
        done = res.get("confirmed") or res.get("discarded") or []
        kept = res.get("not_saved") or []
        if not done and not kept:
            return True, NOTHING_WAITING
        verb = "Saved" if name == "confirm_pending" else "Dropped"
        parts = [f"{verb}: {', '.join(done)}"] if done else []
        parts += [f"Not saved: {k['what']} ({k['why']})" for k in kept]
        return not kept or bool(done), "; ".join(parts)
    if name in ("log_expense", "log_income", "log_transfer", "add_planned"):
        amount = args.get("amount")
        cur = ctx.currency
        code = args.get("currency")
        if code and code != cur.code and code in CODES:
            # Said in another currency: as said, then what it came to.
            cur = currency(code)
        amt = money(round(float(amount) * 100), cur) if amount else ""
        if cur is not ctx.currency and res.get("converted"):
            amt += f" ({res['converted']})"
        what = {
            "log_expense": "Logged expense",
            "log_income": "Logged income",
            "log_transfer": "Logged transfer",
            "add_planned": "Planned payment",
        }[name]
        if res.get("already_waiting"):
            what = "Already waiting"
        label = args.get("category") or args.get("name") or args.get("payee") or ""
        return True, f"{what}: {amt}{f' · {label}' if label else ''}{wait}"
    if name == "create_account":
        bal = float(args.get("opening_balance") or 0)
        amt = f" · {money(round(bal * 100), ctx.currency)}" if bal else ""
        return True, f"Added account: {args.get('name', '')}{amt}{wait}"
    if name == "set_account_balance":
        # A change ("add 100") is reported as the balance it came to.
        minor = res.get("balance_minor")
        if not isinstance(minor, int):
            minor = round(float(args.get("balance") or 0) * 100)
        return (
            True,
            f"Balance: {args.get('account', '')} · {money(minor, ctx.currency)}{wait}",
        )
    if name == "create_category":
        under = f" under {args['parent']}" if args.get("parent") else ""
        return True, f"Added category: {args.get('name', '')}{under}{wait}"
    if name == "create_budget":
        amount = args.get("monthly_limit")
        amt = money(round(float(amount) * 100), ctx.currency) if amount else ""
        return True, f"Budget: {args.get('name', '')} · {amt} a month{wait}"
    if name == "create_routine":
        steps = args.get("steps") or []
        mins = sum(int(s.get("minutes") or 0) for s in steps)
        return (
            True,
            f"Created routine: {args.get('name', '')} · {len(steps)} steps, "
            f"{mins} min{wait}",
        )
    if name in ("create_workout_template", "create_exercise") and res.get("reused"):
        found = res.get("template") or res.get("exercise") or {}
        return True, f"Already in the list: {found.get('name', '')}"
    if name == "create_workout_template":
        n = len(args.get("exercises") or [])
        return (
            True,
            f"Created workout template: {args.get('name', '')} · "
            f"{n} exercise{'s' if n != 1 else ''}{wait}",
        )
    if name == "remember_fact":
        status = res.get("status")
        if status == "duplicate":
            return True, f"Already knew: {res.get('already_known', '')}"
        if status == "updated":
            return True, f"Updated memory: {args.get('fact', '')}"
        return True, f"Remembered: {args.get('fact', '')}"
    if name == "reread_photos":
        n = int(res.get("photos") or 0)
        return True, f"Read {n} photo{'s' if n != 1 else ''} again"
    if name == "recall_memories":
        n = len(res.get("memories") or [])
        return True, f"Recalled {n} thing{'s' if n != 1 else ''} about you"
    if name == "update_routine":
        n = len(args.get("steps") or [])
        what = f" · {n} steps" if n else ""
        return True, f"Updated routine: {args.get('routine', '')}{what}{wait}"
    if name == "update_habit":
        return True, f"Updated habit: {args.get('habit', '')}{wait}"
    if name == "create_task_list":
        n = len(args.get("items") or [])
        items = f" · {n} item{'s' if n != 1 else ''}" if n else ""
        return True, f"Created list: {args.get('name', '')}{items}{wait}"
    simple = {
        "complete_task": f"Marked done: {args.get('query', '')}",
        "log_habit": f"Checked off: {args.get('habit', '')}",
        "create_habit": f"Created habit: {args.get('name') or args.get('spec', '')}",
        "start_routine": f"Started routine: {args.get('query', '')}",
        "log_workout": f"Logged workout: {args.get('name', '')}",
        "log_weigh_in": _weigh(args),
        "log_meal": f"Logged meal: {args.get('description', '')}",
        "save_journal": "Saved a journal entry",
        "edit_last": "Changed the last entry",
        "delete_last": "Removed the last entry",
        "lookup": f"Looked up: {args.get('question', '')}",
        "query_records": f"Read your {args.get('area', '')} records",
        "stats_overview": "Checked your Life Score",
        "show_chart": f"Charted {args.get('metric', '')}",
        "show_insights": "Showed your patterns",
        "coach": "Reviewed how you're doing",
        "plan_day": "Planned your day",
        "track": f"Tracking {args.get('metric', '')}",
        "remember_fact": f"Remembered: {args.get('fact', '')}",
        "forget_fact": "Forgot that",
        "show_memories": "Showed what I remember",
        "suggest": "Suggested next questions",
        "web_search": f"Searched the web: {args.get('query', '')}",
        "nutrition_status": "Checked today's macros",
        "focus_status": "Checked your focus time",
        "start_focus": "Started the focus timer",
        "focus_control": f"Focus timer: {str(args.get('action', '')).replace('_', ' ')}",
        "stop_focus": "Stopped the focus timer",
        "read_photos": (
            f"Read {args.get('photos', '')} photo"
            f"{'' if args.get('photos') == 1 else 's'}"
        ),
    }
    return True, f"{simple.get(name, name.replace('_', ' '))}{wait}"


@dataclass
class Step:
    call_id: str
    name: str
    label: str
    ok: bool = True
    summary: str = ""
    card_id: str | None = None
    state: str | None = None
    # A call that wrote several cards (plain tasks and reminders apart).
    cards: list[dict[str, Any]] = field(default_factory=list)
    # The capture the cards sit on, so the app can fetch it when the
    # finished reply's capture never reached it.
    capture_id: str | None = None

    def public(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "id": self.call_id,
            "tool": self.name,
            "label": self.label,
            "ok": self.ok,
            "summary": self.summary,
        }
        if self.card_id:
            out["card_id"] = self.card_id
            out["state"] = self.state
        if self.cards:
            out["cards"] = self.cards
        if self.capture_id and (self.card_id or self.cards):
            out["capture_id"] = self.capture_id
        return out

    def card_ids(self) -> list[str]:
        ids = [self.card_id] if self.card_id else []
        return ids + [str(c["card_id"]) for c in self.cards if c.get("card_id")]


# The internal record of what a turn did, which a model copying the
# history's format may write into its reply: never shown (see
# ``services.strip_internal`` for the stored reply).
INTERNAL_NOTES = ("done this turn", "already done", "what your earlier replies")
_OPENERS = {"[": "]", "(": ")"}


def _note_prefix(rest: str) -> str:
    """``rest`` (from an opener on) without the opener and its spaces,
    lower-cased: what decides whether it is an internal note."""
    return rest[1:].lstrip(" ").lower()


# Text held back at the start of each model call before it streams: longer
# than the plan DeepSeek says before a tool call (one sentence), short
# enough that an answer starts showing within a moment.
HOLD_CHARS = 240


@dataclass
class TurnStream(capture.LoopHooks):
    """The AG-UI side of one turn. ``sink`` receives every event in order;
    the default drops them (the non-streaming ``/companion/ask``)."""

    ctx: Ctx
    thread_id: str
    run_id: str
    sink: Sink = lambda e: None
    steps: list[Step] = field(default_factory=list)
    _text_id: str | None = None
    # The start of a model call's text, held back until it is long enough to
    # be an answer or the call ends: DeepSeek says its plan ("I'll check your
    # nutrition…") in the answer channel before a tool call, and only the
    # tool call that follows shows it was not the answer.
    _held: str = ""
    # Text from a "[" or "(" that may open an internal note, held until the
    # next characters rule it out or the note ends (at most one line).
    _screened: str = ""
    _turn: int = 0
    _args: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Repeat calls of a once-a-turn tool: run, but shown nowhere.
    _quiet: set[str] = field(default_factory=set)
    # Whether the person asked this reply to stop (see ``gate``), checked
    # at most every STOP_CHECK_SECONDS; once true it stays true.
    stop_check: Callable[[], bool] = lambda: False
    _stopped: bool = False
    _checked_at: float = 0.0
    # The model's thinking being shown: its message id, what is gathered
    # but not yet sent, and when it was last sent.
    _think_id: str | None = None
    _think_buf: str = ""
    _think_at: float = 0.0

    # ---------------------------------------------------------- run

    def started(self) -> None:
        self.sink(RunStartedEvent(thread_id=self.thread_id, run_id=self.run_id))

    def finished(self, result: dict[str, Any]) -> None:
        self.end_reasoning()
        self.end_text()
        self.sink(
            RunFinishedEvent(
                thread_id=self.thread_id, run_id=self.run_id, result=result
            )
        )

    def failed(self, code: str, message: str) -> None:
        self.end_reasoning()
        self.end_text()
        self.sink(RunErrorEvent(message=message, code=code))

    def custom(self, name: str, value: Any) -> None:
        self.sink(CustomEvent(name=name, value=value))

    # ---------------------------------------------------------- reasoning

    def reasoning(self, delta: str) -> None:
        """The model's thinking as it writes it, shown apart from the reply
        (the app folds it away) and never stored with it."""
        if not delta:
            return
        if self._think_id is None:
            self._think_id = str(uuid.uuid4())
            self.sink(ReasoningStartEvent(message_id=self._think_id))
            self.sink(
                ReasoningMessageStartEvent(message_id=self._think_id, role="reasoning")
            )
        self._think_buf += delta
        if time.monotonic() - self._think_at >= REASONING_FLUSH_SECONDS:
            self._send_reasoning()

    def _send_reasoning(self) -> None:
        if self._think_id is not None and self._think_buf:
            self.sink(
                ReasoningMessageContentEvent(
                    message_id=self._think_id, delta=self._think_buf
                )
            )
            self._think_buf = ""
        self._think_at = time.monotonic()

    def end_reasoning(self) -> None:
        if self._think_id is None:
            return
        self._send_reasoning()
        self.sink(ReasoningMessageEndEvent(message_id=self._think_id))
        self.sink(ReasoningEndEvent(message_id=self._think_id))
        self._think_id = None
        self._think_at = 0.0

    # ---------------------------------------------------------- text

    def text(self, delta: str) -> None:
        if not delta:
            return
        # The answer starts: the thinking before it is over.
        self.end_reasoning()
        self._show(self._screen(delta))

    def _screen(self, delta: str) -> str:
        """``delta`` without any internal note, holding back what might
        still turn out to be one."""
        buf, out = self._screened + delta, ""
        self._screened = ""
        while buf:
            at = min((i for i in (buf.find(o) for o in _OPENERS) if i >= 0), default=-1)
            if at < 0:
                return out + buf
            out, rest = out + buf[:at], buf[at:]
            inner = _note_prefix(rest)
            if any(inner.startswith(n) for n in INTERNAL_NOTES):
                close = _OPENERS[rest[0]]
                end = min(
                    (i for i in (rest.find(close), rest.find("\n")) if i >= 0),
                    default=-1,
                )
                if end < 0:
                    self._screened = rest
                    return out
                # The note goes; a line break after it stays.
                buf = rest[end + 1 :] if rest[end] == close else rest[end:]
                continue
            if "\n" not in inner and any(n.startswith(inner) for n in INTERNAL_NOTES):
                self._screened = rest
                return out
            out, buf = out + rest[0], rest[1:]
        return out

    def _screen_end(self) -> str:
        """What is still held when the text ends: a note goes, anything
        else is released."""
        rest, self._screened = self._screened, ""
        inner = _note_prefix(rest)
        return "" if any(inner.startswith(n) for n in INTERNAL_NOTES) else rest

    def _show(self, delta: str) -> None:
        if not delta:
            return
        if self._text_id is None:
            self._held += delta
            if len(self._held.strip()) < HOLD_CHARS:
                return
            delta, self._held = self._held, ""
            self._text_id = str(uuid.uuid4())
            self.sink(TextMessageStartEvent(message_id=self._text_id, role="assistant"))
        self.sink(TextMessageContentEvent(message_id=self._text_id, delta=delta))

    def _release(self) -> None:
        """Send text still held back: the call ended and it is the answer."""
        held, self._held = self._held, ""
        if held.strip():
            self._text_id = str(uuid.uuid4())
            self.sink(TextMessageStartEvent(message_id=self._text_id, role="assistant"))
            self.sink(TextMessageContentEvent(message_id=self._text_id, delta=held))

    def end_text(self) -> None:
        self._show(self._screen_end())
        if self._text_id is None:
            self._release()
        if self._text_id is not None:
            self.sink(TextMessageEndEvent(message_id=self._text_id))
            self._text_id = None

    # ---------------------------------------------------------- loop hooks

    def stopped(self) -> bool:
        if self._stopped:
            return True
        now = time.monotonic()
        if now - self._checked_at >= STOP_CHECK_SECONDS:
            self._checked_at = now
            self._stopped = self.stop_check()
        return self._stopped

    def model_started(self, turn: int) -> None:
        self._turn = turn
        self.sink(StepStartedEvent(step_name=f"think:{turn}"))
        # Once per model call, from the turn that knows one started: the app
        # tells "thinking" from "still thinking" by it (the stream's pings
        # only keep the connection open).
        self.custom("thinking", {"turn": turn})

    def model_finished(self, turn: int, message: BaseMessage) -> None:
        # A model call's text is one message; the next call starts another.
        # A call that goes on to use tools was narrating its plan ("let me
        # check your macros…"), not answering: the app drops that text, so
        # only the answer stays (it still streams as it is written).
        self.end_reasoning()
        planning = bool(getattr(message, "tool_calls", None))
        if planning:
            self._held = self._screened = ""  # held back, so never shown
        said = self._text_id
        self.end_text()
        if said is not None and planning:
            # Narration long enough to have started streaming: the app drops it.
            self.custom("text.discard", {"message_id": said})
        self.sink(StepFinishedEvent(step_name=f"think:{turn}"))

    def tool_started(self, call_id: str, name: str, args: dict[str, Any]) -> None:
        self._args[call_id] = args
        # Tools that run once a turn: a repeat call answers from the first
        # (see `recall_memories`) and shows no second step line.
        if name in ONCE_A_TURN and any(s.name == name for s in self.steps):
            self._quiet.add(call_id)
            return
        self.steps.append(
            Step(call_id=call_id, name=name, label=RUNNING.get(name, name))
        )
        self.sink(StepStartedEvent(step_name=f"tool:{name}"))
        self.sink(ToolCallStartEvent(tool_call_id=call_id, tool_call_name=name))
        self.sink(
            ToolCallArgsEvent(
                tool_call_id=call_id,
                delta=json.dumps(args, ensure_ascii=False, default=str),
            )
        )
        self.sink(ToolCallEndEvent(tool_call_id=call_id))

    def tool_finished(self, call_id: str, name: str, result: Any) -> None:
        if call_id in self._quiet:
            self._quiet.discard(call_id)
            self._args.pop(call_id, None)
            return
        ok, summary = outcome(self.ctx, name, self._args.pop(call_id, {}), result)
        step = next((s for s in self.steps if s.call_id == call_id), None)
        if step is not None:
            step.ok, step.summary = ok, summary
            if isinstance(result, dict) and result.get("card_id"):
                step.card_id = str(result["card_id"])
                step.state = str(result.get("state") or "")
            if isinstance(result, dict) and isinstance(result.get("cards"), list):
                made = [
                    c
                    for c in result["cards"]
                    if isinstance(c, dict) and c.get("card_id")
                ]
                step.cards = [
                    {
                        "card_id": str(c.get("card_id")),
                        "state": str(c.get("state") or ""),
                        "label": ", ".join(c.get("titles") or []),
                    }
                    for c in made
                ]
                if made and made[0].get("capture_id"):
                    step.capture_id = str(made[0]["capture_id"])
            if isinstance(result, dict) and result.get("capture_id"):
                step.capture_id = str(result["capture_id"])
        self.sink(
            ToolCallResultEvent(
                message_id=str(uuid.uuid4()),
                tool_call_id=call_id,
                content=json.dumps(
                    step.public() if step else {"summary": summary, "ok": ok},
                    ensure_ascii=False,
                ),
                role="tool",
            )
        )
        self.sink(StepFinishedEvent(step_name=f"tool:{name}"))

    # ---------------------------------------------------------- frames

    def frame(self, event: str, data: dict[str, Any]) -> None:
        """The cards, blocks and capture frames the tools emit, as AG-UI
        custom events (``card``, ``ask``, ``info``, ``block``, ``capture``)."""
        if event == "text.delta":
            # A nested capture's own reply text (the router's capture path).
            self.custom("capture.text", data)
            return
        self.custom(event, data)

    def steps_block(self) -> dict[str, Any] | None:
        if not self.steps:
            return None
        return {"t": "steps", "items": [s.public() for s in self.steps]}
