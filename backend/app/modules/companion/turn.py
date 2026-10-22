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
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

from ag_ui.core import (
    BaseEvent,
    CustomEvent,
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
from app.shared.context import Ctx
from app.shared.currency import CODES, currency, money

Sink = Callable[[BaseEvent], None]

# What a running step says, per tool ("Adding a task…").
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
    "suggest": "Suggesting next questions",
    "read_photos": "Looking at your photos",
    "web_search": "Searching the web",
    "nutrition_status": "Checking today's macros",
    "find_transactions": "Finding transactions",
    "edit_transaction": "Changing transactions",
    "list_scheduled": "Checking scheduled payments",
    "edit_scheduled": "Changing scheduled payments",
    "edit_account": "Changing an account",
    "edit_budget": "Changing a budget",
    "edit_task": "Changing a task",
    "find_fitness_logs": "Finding your logs",
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


def outcome(ctx: Ctx, name: str, args: dict[str, Any], result: Any) -> tuple[bool, str]:
    """``(ok, sentence)`` for a finished tool call, from its arguments and
    result. A write that waits for the person says so."""
    res = result if isinstance(result, dict) else {}
    if res.get("error"):
        return False, f"Couldn't finish: {str(res['error']).replace('_', ' ')}"
    waiting = res.get("state") in ("proposed", "needs_input")
    wait = " (waiting for your OK)" if waiting else ""
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
        n = len(res.get("meals") or res.get("weigh_ins") or [])
        return True, f"Found {n} log{'s' if n != 1 else ''}"
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
        label = args.get("category") or args.get("name") or args.get("payee") or ""
        return True, f"{what}: {amt}{f' · {label}' if label else ''}{wait}"
    if name == "create_account":
        bal = float(args.get("opening_balance") or 0)
        amt = f" · {money(round(bal * 100), ctx.currency)}" if bal else ""
        return True, f"Added account: {args.get('name', '')}{amt}{wait}"
    if name == "set_account_balance":
        bal = float(args.get("balance") or 0)
        return (
            True,
            f"Balance: {args.get('account', '')} · "
            f"{money(round(bal * 100), ctx.currency)}{wait}",
        )
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
        return out


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
    _turn: int = 0
    _args: dict[str, dict[str, Any]] = field(default_factory=dict)

    # ---------------------------------------------------------- run

    def started(self) -> None:
        self.sink(RunStartedEvent(thread_id=self.thread_id, run_id=self.run_id))

    def finished(self, result: dict[str, Any]) -> None:
        self.end_text()
        self.sink(
            RunFinishedEvent(
                thread_id=self.thread_id, run_id=self.run_id, result=result
            )
        )

    def failed(self, code: str, message: str) -> None:
        self.end_text()
        self.sink(RunErrorEvent(message=message, code=code))

    def custom(self, name: str, value: Any) -> None:
        self.sink(CustomEvent(name=name, value=value))

    # ---------------------------------------------------------- text

    def text(self, delta: str) -> None:
        if not delta:
            return
        if self._text_id is None:
            self._text_id = str(uuid.uuid4())
            self.sink(TextMessageStartEvent(message_id=self._text_id, role="assistant"))
        self.sink(TextMessageContentEvent(message_id=self._text_id, delta=delta))

    def end_text(self) -> None:
        if self._text_id is not None:
            self.sink(TextMessageEndEvent(message_id=self._text_id))
            self._text_id = None

    # ---------------------------------------------------------- loop hooks

    def model_started(self, turn: int) -> None:
        self._turn = turn
        self.sink(StepStartedEvent(step_name=f"think:{turn}"))

    def model_finished(self, turn: int, message: BaseMessage) -> None:
        # A model call's text is one message; the next call starts another.
        self.end_text()
        self.sink(StepFinishedEvent(step_name=f"think:{turn}"))

    def tool_started(self, call_id: str, name: str, args: dict[str, Any]) -> None:
        self._args[call_id] = args
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
        ok, summary = outcome(self.ctx, name, self._args.pop(call_id, {}), result)
        step = next((s for s in self.steps if s.call_id == call_id), None)
        if step is not None:
            step.ok, step.summary = ok, summary
            if isinstance(result, dict) and result.get("card_id"):
                step.card_id = str(result["card_id"])
                step.state = str(result.get("state") or "")
            if isinstance(result, dict) and isinstance(result.get("cards"), list):
                step.cards = [
                    {
                        "card_id": str(c.get("card_id")),
                        "state": str(c.get("state") or ""),
                        "label": ", ".join(c.get("titles") or []),
                    }
                    for c in result["cards"]
                    if isinstance(c, dict) and c.get("card_id")
                ]
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


def stream_events(
    work: Callable[[Sink], None], *, name: str = "companion-turn"
) -> Iterator[str]:
    """Run ``work(sink)`` on a worker thread and yield its AG-UI events as
    SSE as they come (``data: {...}`` frames, ``ag_ui`` encoding). The
    generator waits for the worker before it ends, so the request's database
    session outlives every use of it. An unexpected failure becomes a
    ``RUN_ERROR`` with a fixed message, never the exception's text."""
    import logging
    import queue
    import threading

    from ag_ui.encoder import EventEncoder

    log = logging.getLogger(__name__)
    enc = EventEncoder()
    q: queue.Queue[BaseEvent | None] = queue.Queue()

    def run_it() -> None:
        try:
            work(q.put)
        except Exception as exc:  # noqa: BLE001 - reported as an event, never as text
            log.warning("companion turn failed: %s", type(exc).__name__)
            q.put(
                RunErrorEvent(
                    message="Couldn't finish that reply.", code="reply_failed"
                )
            )
        finally:
            q.put(None)

    t = threading.Thread(target=run_it, name=name, daemon=True)
    t.start()
    try:
        while True:
            item = q.get()
            if item is None:
                break
            yield enc.encode(item)
    finally:
        t.join()
