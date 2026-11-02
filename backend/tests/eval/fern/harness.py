"""Replays one recorded Fern turn and checks what Fern did (ADR-0029).

A case is a JSON file in ``cases/``: the chat so far, the records that
existed at that moment, the message (or a queued burst of messages) the
person sent, and what Fern should have done. :func:`run_case` seeds a fresh
user with that state, pins the clock to the moment the message was sent
(``make_ctx(now=...)``, which every turn reads its time from) and sends each
message through ``services.ask``, the same call the app's chat makes. What
the turn did is kept as a :class:`Trace`: every tool with its arguments and
result, every row it wrote, the reply, its tokens, cost and time.

:func:`check` turns a case's ``expect`` block into pass/fail assertions on
the trace; ``judge.py`` scores the reply against Kai's ten criteria.
"""

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import Date, DateTime, select
from sqlalchemy import Uuid as SAUuid
from sqlmodel import Session, SQLModel

from app.modules.ai_providers.models import AIUsage
from app.modules.capture.models import Capture, RecordCard
from app.modules.companion import services
from app.modules.companion.models import CompanionMessage, CompanionThread, Memory
from app.modules.companion.turn import TurnStream
from app.modules.finance.models import Account, Category, FinRecord
from app.modules.fitness.models import (
    Exercise,
    FoodItem,
    MacroTarget,
    Meal,
    MealItem,
    TemplateItem,
    WeighIn,
    Workout,
    WorkoutExercise,
    WorkoutSet,
    WorkoutTemplate,
)
from app.modules.habits.models import Habit, HabitLog
from app.modules.iam.users.models import User
from app.modules.profile import public as profile
from app.modules.tasks.models import Task
from app.shared.context import Ctx, make_ctx

CASES = Path(__file__).parent / "cases"

# The records a case may seed and a turn may write, by table name, in the
# order they are inserted (parents first).
TABLES: dict[str, type[SQLModel]] = {
    "account": Account,
    "category": Category,
    "fin_record": FinRecord,
    "habit": Habit,
    "habit_log": HabitLog,
    "task": Task,
    "macro_target": MacroTarget,
    "food_item": FoodItem,
    "meal": Meal,
    "meal_item": MealItem,
    "exercise": Exercise,
    "workout_template": WorkoutTemplate,
    "template_item": TemplateItem,
    "workout": Workout,
    "workout_exercise": WorkoutExercise,
    "workout_set": WorkoutSet,
    "weigh_in": WeighIn,
    "memory": Memory,
    # Entries still waiting for the person's Confirm at that moment.
    "capture": Capture,
    "record_card": RecordCard,
}
SELF_REFS = ("parent_id", "series_parent_id", "merged_into_id")
# Columns a case never sets: the owner, tenant and row bookkeeping.
OWNED = {"owner_id", "tenant_id", "created_at", "updated_at", "version"}

# Kai's ten criteria, as the judge and the report name them.
CRITERIA: dict[int, str] = {
    1: "Accurate data: pulls the correct data",
    2: "Correct data at the correct time (right day, fresh)",
    3: "Identifies the info needed to answer",
    4: "Never just agrees: agrees only when data backs it",
    5: "Asks the right question, fast (user or tools/sources)",
    6: "Follows through across the whole conversation",
    7: "Handles choppy queued messages as one thought",
    8: "Low-confidence assumptions asked as multiple choice first",
    9: "Gathers before concluding",
    10: "Fills every expected field when recording",
}

# Meal item fields a logged food must carry (#221: saturated fat, sugar and
# sodium were left out).
MEAL_FIELDS = ("kcal", "protein", "carbs", "fat", "fiber", "sat_fat", "sugar", "sodium")


# ---------------------------------------------------------------- the case


class Said(BaseModel):
    role: Literal["me", "sol"]
    text: str
    at: datetime


class Sent(BaseModel):
    text: str
    at: datetime


class ToolArg(BaseModel):
    tool: str
    # A dotted path into the arguments ("items.0.sodium"); "*" matches any
    # list element.
    path: str
    equals: Any = None
    one_of: list[Any] | None = None
    present: bool | None = None


class Asks(BaseModel):
    # "choice": a multiple-choice form (a card's ask with options, or the
    # reply's choices/chips); "any": a question in any form.
    form: Literal["choice", "any"] = "any"
    about: str = ""


class Expect(BaseModel):
    # Each inner list: at least one of these tools must be called.
    tools_any: list[list[str]] = Field(default_factory=list)
    # None of these may be called.
    tools_none: list[str] = Field(default_factory=list)
    # A read tool must run before the reply agrees with the person.
    read_first: list[str] = Field(default_factory=list)
    tool_args: list[ToolArg] = Field(default_factory=list)
    # Table -> fields every new row (and every waiting card's item) must fill.
    fields: dict[str, list[str]] = Field(default_factory=dict)
    # Table -> least number of new rows (saved or waiting on a card).
    writes_min: dict[str, int] = Field(default_factory=dict)
    no_writes: bool = False
    # The label the logged meal ends up with (breakfast/lunch/dinner/snack).
    meal_label: list[str] = Field(default_factory=list)
    asks: Asks | None = None
    no_question: bool = False
    # Number of replies: a queued burst answered as one thought gets one.
    replies_max: int | None = None
    reply_any: list[str] = Field(default_factory=list)
    reply_none: list[str] = Field(default_factory=list)


class Case(BaseModel):
    id: str
    kind: Literal["failure", "guard"]
    title: str
    # The day the source chat happened, and the fix that may already
    # address the failure (from grading).
    seen: str = ""
    maybe_fixed_by: str | None = None
    criteria: list[int]
    severity: Literal["high", "medium", "low"] = "medium"
    # What happened in the recorded chat, and what should have (scrubbed).
    fern_did: str = ""
    should_have: str = ""
    name: str = "Sam"
    timezone: str = "Asia/Manila"
    history: list[Said] = Field(default_factory=list)
    records: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    turn: list[Sent]
    expect: Expect = Field(default_factory=Expect)
    # What good looks like, for the judge.
    rubric: str = ""


def load_cases() -> list[Case]:
    return [
        Case.model_validate_json(p.read_text()) for p in sorted(CASES.glob("*.json"))
    ]


# ---------------------------------------------------------------- seeding


def ref(case_id: str, key: str) -> uuid.UUID:
    """A case's symbolic row id ("@meal1") as a stable uuid."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"fern-eval:{case_id}:{key}")


def _value(case_id: str, column: Any, v: Any) -> Any:
    if isinstance(v, str) and v.startswith("@"):
        return ref(case_id, v[1:])
    if v is None:
        return None
    if isinstance(column.type, DateTime) and isinstance(v, str):
        return datetime.fromisoformat(v)
    if isinstance(column.type, Date) and isinstance(v, str):
        return date.fromisoformat(v)
    if isinstance(column.type, SAUuid) and isinstance(v, str):
        return uuid.UUID(v)
    return v


def seed(session: Session, user: User, case: Case) -> uuid.UUID:
    """The person's profile, records and chat as they were; returns the
    chat's id."""
    ctx = make_ctx(session, user, now=case.turn[0].at)
    prof = profile.get_profile(ctx)
    prof.timezone = case.timezone
    prof.name = case.name
    session.add(prof)
    session.flush()
    ctx = make_ctx(session, user, now=case.turn[0].at)
    for table, model in TABLES.items():
        cols = model.__table__.c  # type: ignore[attr-defined]
        # A row pointing at another row of its own table goes after it.
        rows = sorted(
            case.records.get(table, []),
            key=lambda r: any(r.get(k) for k in SELF_REFS),
        )
        for raw in rows:
            values = {
                k: _value(case.id, cols[k], v)
                for k, v in raw.items()
                if k not in OWNED and k in cols
            }
            values["id"] = values.get("id") or uuid.uuid4()
            session.add(model(**values, **ctx.owned()))
            if any(values.get(k) for k in SELF_REFS):
                session.flush()
        session.flush()
    thread = ref(case.id, "thread")
    first = case.history[0].at if case.history else case.turn[0].at
    session.add(
        CompanionThread(id=thread, created_at=first, last_at=first, **ctx.owned())
    )
    session.flush()
    for i, m in enumerate(case.history):
        session.add(
            CompanionMessage(
                id=ref(case.id, f"history{i}"),
                thread_id=thread,
                role=m.role,
                text=m.text,
                created_at=m.at,
                updated_at=m.at,
                **ctx.owned(),
            )
        )
    session.commit()
    return thread


# ---------------------------------------------------------------- the trace


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]
    result: Any = None
    turn: int = 0


@dataclass
class Trace:
    calls: list[ToolCall] = field(default_factory=list)
    replies: list[str] = field(default_factory=list)
    blocks: list[list[dict[str, Any]]] = field(default_factory=list)
    # Table -> rows the turn added (as dicts).
    written: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    # Cards waiting for the person (proposed / needs_input), with their ask.
    waiting: list[dict[str, Any]] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_minor: int = 0
    model_calls: int = 0
    seconds: float = 0.0
    error: str | None = None

    def names(self) -> list[str]:
        return [c.name for c in self.calls]

    def public(self) -> dict[str, Any]:
        return {
            "calls": [
                {
                    "name": c.name,
                    "args": c.args,
                    "result": json.dumps(c.result, default=str, ensure_ascii=False)[
                        :1500
                    ],
                    "turn": c.turn,
                }
                for c in self.calls
            ],
            "replies": self.replies,
            "blocks": self.blocks,
            "written": self.written,
            "waiting": self.waiting,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_minor": self.cost_minor,
            "model_calls": self.model_calls,
            "seconds": round(self.seconds, 2),
            "error": self.error,
        }


@dataclass
class RecordingStream(TurnStream):
    """A turn's stream that also keeps each tool's arguments and result."""

    calls: list[ToolCall] = field(default_factory=list)
    turn_no: int = 0

    def tool_started(self, call_id: str, name: str, args: dict[str, Any]) -> None:
        self.calls.append(ToolCall(name=name, args=dict(args), turn=self.turn_no))
        super().tool_started(call_id, name, args)

    def tool_finished(self, call_id: str, name: str, result: Any) -> None:
        for c in reversed(self.calls):
            if c.name == name and c.result is None:
                c.result = result
                break
        super().tool_finished(call_id, name, result)


def _row(r: SQLModel) -> dict[str, Any]:
    return {
        k: v
        for k, v in json.loads(r.model_dump_json()).items()
        if k not in OWNED and k not in ("deleted_at", "tenant_id")
    }


def _ids(session: Session, user_id: uuid.UUID) -> dict[str, set[uuid.UUID]]:
    out: dict[str, set[uuid.UUID]] = {}
    for table, model in TABLES.items():
        q = select(model.id).where(model.owner_id == user_id)  # type: ignore[attr-defined]
        out[table] = set(session.execute(q).scalars())
    return out


def _cards(session: Session, user_id: uuid.UUID) -> set[uuid.UUID]:
    q = select(RecordCard.id).where(RecordCard.owner_id == user_id)  # type: ignore[arg-type]
    return set(session.execute(q).scalars())


def run_case(session: Session, user: User, case: Case) -> Trace:
    """Send the case's message(s) the way the app does, one turn each, at
    the moments they were sent. A queued burst is several turns; a design
    that coalesces them may answer once (``replies_max``)."""
    thread = seed(session, user, case)
    trace = Trace()
    before = _ids(session, user.id)
    cards_before = _cards(session, user.id)
    usage_from = session.execute(
        select(AIUsage.id).where(AIUsage.owner_id == user.id)  # type: ignore[arg-type]
    ).scalars()
    seen_usage = set(usage_from)
    started = time.monotonic()
    for i, sent in enumerate(case.turn):
        ctx: Ctx = make_ctx(session, user, now=sent.at)
        me_id = ref(case.id, f"turn{i}")
        stream = RecordingStream(
            ctx, thread_id=f"companion:{user.id}", run_id=str(me_id), turn_no=i
        )
        try:
            out = services.ask(
                ctx, text=sent.text, message_id=me_id, stream=stream, thread_id=thread
            )
        except Exception as exc:  # noqa: BLE001 - a crash is a failed case
            session.rollback()
            trace.error = f"{type(exc).__name__}: {exc}"[:500]
            break
        trace.calls.extend(stream.calls)
        for m in out.messages:
            if m.role == "sol":
                trace.replies.append(m.text or "")
                trace.blocks.append(list(m.blocks or []))
        if out.kind == "capture" and out.capture:
            trace.replies.append(str(out.capture.get("reply_text") or ""))
            trace.blocks.append([])
        # The turn's messages are stamped with the wall clock; they belong
        # at the moment they were sent, or the next message in a burst reads
        # them as another day's.
        for row in session.execute(
            select(CompanionMessage).where(
                CompanionMessage.thread_id == thread,  # type: ignore[arg-type]
                CompanionMessage.created_at > sent.at + timedelta(minutes=5),  # type: ignore[arg-type]
            )
        ).scalars():
            row.created_at = sent.at + timedelta(seconds=1 if row.role == "sol" else 0)
            session.add(row)
        session.commit()
    trace.seconds = time.monotonic() - started
    after = _ids(session, user.id)
    for table, model in TABLES.items():
        if table in ("capture", "record_card", "memory"):
            continue  # waiting entries are read from the cards below
        new = after[table] - before[table]
        if new:
            rows = session.execute(
                select(model).where(model.id.in_(new))  # type: ignore[attr-defined]
            ).scalars()
            trace.written[table] = [_row(r) for r in rows]
    for card in session.execute(
        select(RecordCard).where(
            RecordCard.id.in_(_cards(session, user.id) - cards_before)
        )  # type: ignore[attr-defined]
    ).scalars():
        if card.state in ("proposed", "needs_input"):
            trace.waiting.append(
                {
                    "kind": card.kind,
                    "state": card.state,
                    "ask": card.ask,
                    "payload": card.payload,
                }
            )
    for u in session.execute(
        select(AIUsage).where(AIUsage.owner_id == user.id)  # type: ignore[arg-type]
    ).scalars():
        if u.id in seen_usage:
            continue
        trace.model_calls += 1
        trace.input_tokens += u.input_tokens or 0
        trace.output_tokens += u.output_tokens or 0
        trace.cost_minor += u.cost_minor or 0
    return trace


# ---------------------------------------------------------------- checks


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    criteria: list[int] = field(default_factory=list)


def _dig(obj: Any, path: list[str]) -> list[Any]:
    if not path:
        return [obj]
    head, rest = path[0], path[1:]
    if isinstance(obj, list):
        if head == "*":
            return [v for o in obj for v in _dig(o, rest)]
        if head.isdigit() and int(head) < len(obj):
            return _dig(obj[int(head)], rest)
        return []
    if isinstance(obj, dict) and head in obj:
        return _dig(obj[head], rest)
    return []


def _items(trace: Trace, table: str) -> list[dict[str, Any]]:
    """New rows of ``table`` plus the matching items on waiting cards (a
    meal waiting for Confirm is still what Fern recorded)."""
    rows = list(trace.written.get(table, []))
    if table == "meal_item":
        for c in trace.waiting:
            if c["kind"] in ("meal", "mealLog"):
                rows.extend(c["payload"].get("items") or [])
    if table == "meal":
        rows.extend(
            c["payload"] for c in trace.waiting if c["kind"] in ("meal", "mealLog")
        )
    if table == "task":
        for c in trace.waiting:
            if c["kind"] == "task":
                rows.extend(c["payload"].get("tasks") or [])
    if table == "fin_record":
        rows.extend(
            c["payload"]
            for c in trace.waiting
            if c["kind"] in ("expense", "income", "transfer")
        )
    return rows


def meal_labels(case: Case, trace: Trace) -> list[str]:
    """The label each meal the turn logged has, or will have once
    confirmed: the model's word for it, else the hour it was eaten."""
    from app.modules.fitness.calc import label_for_time
    from app.shared.day import DayClock

    clock = DayClock(timezone=case.timezone)
    out = [str(m["label"]) for m in trace.written.get("meal", [])]
    for c in trace.waiting:
        if c["kind"] == "meal":
            p = c["payload"]
            at = case.turn[-1].at
            out.append(str(p.get("label") or label_for_time(at, clock)))
    return out


def asked(trace: Trace) -> tuple[bool, bool]:
    """(asked anything, asked as a multiple-choice form): a waiting card's
    ask with options, a choices block, or chips under a reply that asks."""
    questions = any("?" in r for r in trace.replies)
    choice = any(
        isinstance(c.get("ask"), dict) and bool(c["ask"].get("options"))
        for c in trace.waiting
    ) or any(
        (b.get("t") == "choices" and bool(b.get("options")))
        or (b.get("t") == "chips" and bool(b.get("prompts")) and questions)
        for bl in trace.blocks
        for b in bl
    )
    return questions or choice, choice


def check(case: Case, trace: Trace) -> list[Check]:
    e = case.expect
    names = trace.names()
    out: list[Check] = []
    if trace.error:
        out.append(Check("turn ran", False, trace.error, [6]))
        return out
    for group in e.tools_any:
        hit = [n for n in names if n in group]
        out.append(
            Check(f"called one of {group}", bool(hit), f"called {names}", [3, 5, 9])
        )
    for t in e.tools_none:
        out.append(
            Check(f"did not call {t}", t not in names, f"called {names}", [4, 9])
        )
    if e.read_first:
        reads = [i for i, n in enumerate(names) if n in e.read_first]
        writes = [i for i, n in enumerate(names) if n in services.WRITE_TOOLS]
        ok = bool(reads) and (not writes or min(reads) < min(writes))
        out.append(
            Check(
                f"read {e.read_first} before answering", ok, f"called {names}", [4, 9]
            )
        )
    for a in e.tool_args:
        vals = [
            v
            for c in trace.calls
            if c.name == a.tool
            for v in _dig(c.args, a.path.split("."))
        ]
        if a.present is not None:
            ok = bool(vals) == a.present and (
                not a.present or all(v not in (None, "") for v in vals)
            )
        elif a.one_of is not None:
            ok = bool(vals) and all(v in a.one_of for v in vals)
        else:
            ok = bool(vals) and all(v == a.equals for v in vals)
        out.append(Check(f"{a.tool}.{a.path}", ok, f"got {vals}", [1, 10]))
    for table, n in e.writes_min.items():
        got = len(_items(trace, table))
        out.append(Check(f"wrote {n}+ {table}", got >= n, f"wrote {got}", [6, 10]))
    for table, cols in e.fields.items():
        rows = _items(trace, table)
        blank = sorted({c for r in rows for c in cols if r.get(c) in (None, "")})
        out.append(
            Check(
                f"{table} fields filled",
                bool(rows) and not blank,
                f"{len(rows)} rows; blank: {blank}" if rows else "nothing written",
                [10],
            )
        )
    if e.meal_label:
        labels = meal_labels(case, trace)
        out.append(
            Check(
                f"meal labelled {e.meal_label}",
                bool(labels) and all(lb in e.meal_label for lb in labels),
                f"labels {labels}",
                [9],
            )
        )
    if e.no_writes:
        wrote = {t: len(r) for t, r in trace.written.items() if r}
        out.append(Check("wrote nothing", not wrote, f"wrote {wrote}", [4, 9]))
    q_any, q_choice = asked(trace)
    if e.asks is not None:
        ok = q_choice if e.asks.form == "choice" else q_any
        out.append(
            Check(
                f"asked ({e.asks.form}) about {e.asks.about}",
                ok,
                f"question={q_any} choice={q_choice}",
                [5, 8] if e.asks.form == "choice" else [5],
            )
        )
    if e.no_question:
        out.append(Check("answered without asking", not q_any, "", [5]))
    if e.replies_max is not None:
        n = len([r for r in trace.replies if r.strip()])
        out.append(
            Check(
                f"at most {e.replies_max} replies",
                n <= e.replies_max,
                f"{n} replies",
                [7],
            )
        )
    text = "\n".join(trace.replies).lower()
    for any_of in [e.reply_any] if e.reply_any else []:
        out.append(
            Check(
                f"reply mentions one of {any_of}",
                any(s.lower() in text for s in any_of),
                "",
                [1],
            )
        )
    for s in e.reply_none:
        out.append(Check(f"reply avoids {s!r}", s.lower() not in text, "", [1, 4]))
    return out
