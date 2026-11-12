"""Fern's server-side queue: every message is answered on the server, in
order, one turn at a time per person, whether or not the app is open.

Kai, 2026-11-12: "the message queues are not automatically registered to
the chat agent … it needs the user to open again the chat or the app
before the queue will be answered." Messages typed while Fern was still
answering waited on the phone, and went only when the app was open.

Now the app hands each message to the server the moment it is sent
(``POST /companion/messages``, or ``/companion/ask/stream`` which also
follows the reply live). The message is stored here (``CompanionAsk``,
keyed by its own id, so a resend never runs a second turn) and a drain
starts on this API task at once. The worker runs a drain for the same
person a minute later as a backstop, and a sweep every minute restarts
any queue a dead task left behind (``jobs.tasks``).

A drain claims the person's oldest waiting message in a short transaction
that locks their ``user`` row, so two drains (two API tasks, the worker)
never claim at once. A claimed message carries a lease the turn renews
every heartbeat; no connection is held while the model thinks. A message
found ``running`` with a lapsed lease belongs to a task that died: it runs
again (with backoff, at most ``MAX_ATTEMPTS`` times) when nothing it did
can be doubled, else it fails with ``interrupted`` and the chat offers
Retry. Never a silent drop, never a reply that claims to be done.
"""

import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ag_ui.core import CustomEvent, RunErrorEvent
from fastapi import HTTPException
from sqlalchemy import text as sql
from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.modules.companion import feedback, gate, memory, notify, runs, services, turn
from app.modules.companion.models import CompanionAsk, CompanionMessage
from app.modules.companion.schema import AskIn
from app.modules.iam.deps import release_connection
from app.modules.iam.users.models import User
from app.modules.profile import public as profile
from app.modules.sync import written
from app.shared.context import Ctx, make_ctx
from app.shared.events import publish
from app.shared.ids import derived_id
from app.shared.owned import utcnow
from app.shared.tenant_session import get_tenant_scoped_session

log = logging.getLogger(__name__)

# Turns started for one message, at most (the first and two retries).
MAX_ATTEMPTS = 3
# Wait before attempt 2, 3, … of a turn that failed.
BACKOFF_SECONDS: tuple[float, ...] = (2.0, 10.0, 30.0)
# A running turn's claim lapses this long after its last heartbeat.
LEASE_SECONDS = 90
HEARTBEAT_SECONDS = runs.HEARTBEAT_SECONDS
# The worker's backstop drain runs this long after a message is queued:
# by then the API task's own drain has normally answered it.
BACKUP_DELAY_SECONDS = 60

ERRORS = {
    "interrupted": "Couldn't finish that reply. Tap Retry to run it again.",
    "reply_failed": "Couldn't finish that reply.",
}


@dataclass(frozen=True)
class Claim:
    id: uuid.UUID
    owner_id: uuid.UUID
    thread_id: uuid.UUID | None
    text: str
    media_ids: list[uuid.UUID]
    attempts: int
    created_at: datetime


# ------------------------------------------------------------------ enqueue


def enqueue(ctx: Ctx, data: AskIn, *, replay: bool = False) -> CompanionAsk:
    """Keep the message ``data`` for Fern to answer; idempotent by its id.

    A resend of a message still waiting or running changes nothing. One
    that failed is queued again (the person's Retry). ``replay`` (the
    streaming route) also queues a finished message whose events are no
    longer kept, so its stored reply is read back to the stream. 409 when
    the id is another person's."""
    ask_id = data.id or uuid.uuid4()
    res = ctx.session.execute(
        insert(CompanionAsk)
        .values(
            id=ask_id,
            **ctx.owned(),
            created_at=ctx.now,
            updated_at=ctx.now,
            thread_id=data.thread_id,
            text=data.text,
            media_ids=[str(m) for m in data.media_ids],
            status="queued",
        )
        .on_conflict_do_nothing(index_elements=["id"])
        .returning(col(CompanionAsk.id))
    )
    row = ctx.session.exec(
        select(CompanionAsk).where(
            CompanionAsk.id == ask_id, CompanionAsk.owner_id == ctx.user_id
        )
    ).first()
    if row is None:
        ctx.session.rollback()
        raise HTTPException(status_code=409, detail="Message id already used")
    fresh = res.first() is not None
    again = row.status == "failed" or (
        replay and row.status == "done" and not runs.exists(ctx.user_id, str(row.id))
    )
    if again:
        row.status, row.attempts, row.wrote = "queued", 0, False
        row.error, row.not_before, row.finished_at = None, None, None
        row.updated_at = ctx.now
        ctx.session.add(row)
    ctx.commit()
    if fresh or again:
        sink = runs.open_events(ctx.user_id, str(row.id), fresh=True)
        ahead = _ahead(ctx.user_id, row)
        if ahead:
            sink(CustomEvent(name="queued", value={"behind": ahead}))
    return row


def _ahead(owner: uuid.UUID, row: CompanionAsk) -> int:
    with Session(engine) as s:
        return len(
            s.exec(
                select(CompanionAsk.id).where(
                    CompanionAsk.owner_id == owner,
                    col(CompanionAsk.status).in_(("queued", "running")),
                    CompanionAsk.created_at < row.created_at,
                )
            ).all()
        )


def status(ctx: Ctx, ask_id: uuid.UUID) -> CompanionAsk | None:
    return ctx.session.exec(
        select(CompanionAsk).where(
            CompanionAsk.id == ask_id, CompanionAsk.owner_id == ctx.user_id
        )
    ).first()


def pending(owner: uuid.UUID, ask_id: uuid.UUID) -> bool:
    """Whether the message is still waiting for or in a turn."""
    with Session(engine) as s:
        got = s.exec(
            select(CompanionAsk.status).where(
                CompanionAsk.id == ask_id, CompanionAsk.owner_id == owner
            )
        ).first()
    return got in ("queued", "running")


# --------------------------------------------------------------------- kick


def kick(owner: uuid.UUID, delay: float = 0.0) -> None:
    """Start a drain for ``owner`` on this task (after ``delay`` seconds),
    and, where the worker runs, a backstop drain there."""

    def later() -> None:
        if delay > 0:
            time.sleep(delay)
        try:
            drain(owner)
        except Exception:  # noqa: BLE001 - the backstop and sweep recover it
            log.warning("companion drain failed", exc_info=True)

    threading.Thread(target=later, name="companion-drain", daemon=True).start()
    if settings.JOBS_ENABLED:
        _defer_backstop(owner, delay)


def _defer_backstop(owner: uuid.UUID, delay: float) -> None:
    from procrastinate.exceptions import AlreadyEnqueued

    from app.modules.jobs.tasks import companion_drain

    try:
        companion_drain.configure(
            queueing_lock=f"companion.drain:{owner}",
            schedule_in={"seconds": int(delay) + BACKUP_DELAY_SECONDS},
        ).defer(owner_id=str(owner))
    except AlreadyEnqueued:
        pass  # a backstop for this person is already waiting
    except Exception:  # noqa: BLE001 - the sweep still finds the queue
        log.warning("companion backstop not deferred", exc_info=True)


def stalled_owners(now: datetime | None = None) -> list[uuid.UUID]:
    """People with a message ready to run and nothing running for it, or a
    turn whose lease lapsed (its task died)."""
    at = now or utcnow()
    with Session(engine) as s:
        rows = s.exec(
            select(
                CompanionAsk.owner_id,
                CompanionAsk.status,
                CompanionAsk.lease_until,
                CompanionAsk.not_before,
            ).where(col(CompanionAsk.status).in_(("queued", "running")))
        ).all()
    live = {o for o, st, lease, _ in rows if st == "running" and lease and lease > at}
    out: dict[uuid.UUID, None] = {}
    for o, st, _lease, nb in rows:
        if o in live:
            continue
        if st == "running" or nb is None or nb <= at:
            out[o] = None
    return list(out)


# Answered or failed messages are kept this long, then dropped by the sweep.
# A resend after that is still answered once: the stored question and reply
# are the record, and a new row reads them back.
KEEP_ENDED = timedelta(days=7)


def sweep() -> int:
    """Kick a drain for every stalled queue (the worker, every minute), and
    drop rows that ended long ago."""
    owners = stalled_owners()
    for o in owners:
        kick(o)
    prune()
    return len(owners)


def prune(now: datetime | None = None, *, limit: int = 1000) -> int:
    """Drop up to ``limit`` rows that ended before ``KEEP_ENDED`` ago."""
    cut = (now or utcnow()) - KEEP_ENDED
    with Session(engine) as s:
        res = s.execute(
            sql(
                "DELETE FROM companion_ask WHERE id IN ("
                " SELECT id FROM companion_ask"
                " WHERE status IN ('done', 'failed') AND updated_at < :cut"
                " LIMIT :n)"
            ),
            {"cut": cut, "n": limit},
        )
        s.commit()
    return int(getattr(res, "rowcount", 0) or 0)


# -------------------------------------------------------------------- drain


def drain(owner: uuid.UUID) -> int:
    """Answer ``owner``'s waiting messages, oldest first, one at a time.
    Returns how many were answered. Leaves at once when another drain is
    running a turn for them; that drain answers what waits."""
    answered = 0
    while True:
        claim, wake_at = _claim(owner)
        if claim is None:
            if wake_at is not None:
                kick(owner, max(0.0, (wake_at - utcnow()).total_seconds()))
            return answered
        if _run(claim):
            answered += 1


def _lock_owner(s: Session, owner: uuid.UUID) -> None:
    # Serialises claims per person. NO KEY UPDATE: rows that only reference
    # the user (every insert of theirs) are not blocked.
    s.execute(sql('SELECT 1 FROM "user" WHERE id = :u FOR NO KEY UPDATE'), {"u": owner})


def _backoff(attempts: int) -> float:
    i = max(0, min(attempts - 1, len(BACKOFF_SECONDS) - 1))
    return BACKOFF_SECONDS[i]


def _claim(owner: uuid.UUID) -> tuple[Claim | None, datetime | None]:
    ended: list[tuple[uuid.UUID, str]] = []
    with Session(engine) as s:
        _lock_owner(s, owner)
        now = utcnow()
        running = s.exec(
            select(CompanionAsk).where(
                CompanionAsk.owner_id == owner, CompanionAsk.status == "running"
            )
        ).all()
        if any(r.lease_until is not None and r.lease_until > now for r in running):
            s.commit()
            return None, None
        for r in running:
            # Its task died mid-turn (the lease lapsed while we hold the lock).
            if _answered(s, r):
                # It died after the reply was stored: done, nothing to redo.
                r.status, r.finished_at, r.lease_until = "done", now, None
            elif r.wrote:
                _fail(r, "interrupted", now)
                ended.append((r.id, "interrupted"))
            elif r.attempts >= MAX_ATTEMPTS:
                _fail(r, "reply_failed", now)
                ended.append((r.id, "reply_failed"))
            else:
                # The lapsed lease was the wait: it runs again now.
                r.status = "queued"
                r.not_before = None
                r.lease_until = None
            r.updated_at = now
            s.add(r)
        nxt = s.exec(
            select(CompanionAsk)
            .where(CompanionAsk.owner_id == owner, CompanionAsk.status == "queued")
            .order_by(col(CompanionAsk.created_at), col(CompanionAsk.id))
            .limit(1)
        ).first()
        if nxt is None or (nxt.not_before is not None and nxt.not_before > now):
            wake = nxt.not_before if nxt is not None else None
            s.commit()
            for rid, code in ended:
                _ended_failed(owner, rid, code)
            return None, wake
        nxt.status = "running"
        nxt.attempts += 1
        nxt.started_at = now
        nxt.not_before = None
        nxt.lease_until = now + timedelta(seconds=LEASE_SECONDS)
        nxt.updated_at = now
        s.add(nxt)
        s.commit()
        claim = Claim(
            id=nxt.id,
            owner_id=owner,
            thread_id=nxt.thread_id,
            text=nxt.text,
            media_ids=[uuid.UUID(m) for m in nxt.media_ids],
            attempts=nxt.attempts,
            created_at=nxt.created_at,
        )
    for rid, code in ended:
        _ended_failed(owner, rid, code)
    return claim, None


def _answered(s: Session, row: CompanionAsk) -> bool:
    """Whether the reply to ``row`` (a message, or the capture a log
    became) is already stored."""
    reply = s.get(CompanionMessage, derived_id("companion-reply", row.id, "sol"))
    if reply is not None and reply.deleted_at is None:
        return True
    return (
        s.execute(
            sql("SELECT 1 FROM capture WHERE id = :id"),
            {"id": derived_id("companion-capture", row.id, "capture")},
        ).first()
        is not None
    )


def _fail(row: CompanionAsk, code: str, now: datetime) -> None:
    row.status, row.error, row.finished_at = "failed", code[:40], now
    row.lease_until = None


def _ended_failed(owner: uuid.UUID, ask_id: uuid.UUID, code: str) -> None:
    """Tell readers and the app a message failed for good."""
    try:
        sink = runs.open_events(owner, str(ask_id), fresh=False)
        sink(RunErrorEvent(message=ERRORS.get(code, ERRORS["reply_failed"]), code=code))
        runs.end(owner, str(ask_id))
    except Exception:  # noqa: BLE001 - the row says failed whatever Redis does
        log.warning("companion failure event not written", exc_info=True)
    publish(owner, "companion.reply", {"message_id": str(ask_id), "failed": True})


def _update(ask_id: uuid.UUID, **values: Any) -> None:
    with Session(engine) as s:
        row = s.get(CompanionAsk, ask_id)
        if row is None:
            return
        for k, v in values.items():
            setattr(row, k, v)
        row.updated_at = utcnow()
        s.add(row)
        s.commit()


def _renew(ask_id: uuid.UUID) -> None:
    with Session(engine) as s:
        s.execute(
            sql(
                "UPDATE companion_ask SET lease_until = :until "
                "WHERE id = :id AND status = 'running'"
            ),
            {"id": ask_id, "until": utcnow() + timedelta(seconds=LEASE_SECONDS)},
        )
        s.commit()


def _run(claim: Claim) -> bool:
    """Run one claimed turn. True when its reply was stored."""
    owner, run_id = claim.owner_id, str(claim.id)
    sink = runs.open_events(owner, run_id, fresh=False)
    runs.alive(owner, run_id)
    done = threading.Event()

    def beat() -> None:
        while not done.wait(HEARTBEAT_SECONDS):
            try:
                runs.alive(owner, run_id)
                _renew(claim.id)
            except Exception:  # noqa: BLE001 - a missed beat never ends the turn
                log.warning("companion heartbeat failed", exc_info=True)

    threading.Thread(target=beat, name="companion-beat", daemon=True).start()
    wrote = [False]

    def on_tool(name: str) -> None:
        if name in services.WRITE_TOOLS and not wrote[0]:
            wrote[0] = True
            _update(claim.id, wrote=True)

    code: str | None = None
    try:
        with Session(engine) as s:
            user = s.get(User, owner)
        if user is None:
            _update(
                claim.id, status="failed", error="reply_failed", finished_at=utcnow()
            )
            runs.end(owner, run_id)
            return False
        sessions = get_tenant_scoped_session(user)
        ctx = make_ctx(next(sessions), user)
        try:
            code = _turn(ctx, claim, sink, on_tool)
        finally:
            sessions.close()
    except Exception:  # noqa: BLE001 - recovered below, reported as an event
        log.warning("companion turn failed", exc_info=True)
        code = "error"
    finally:
        done.set()
        gate.clear_stop(owner, run_id)
    if code is None:
        return True
    return _after_failure(claim, code, sink, wrote[0])


def _after_failure(claim: Claim, code: str, sink: runs.Sink, wrote: bool) -> bool:
    owner, run_id = claim.owner_id, str(claim.id)
    with Session(engine) as s:
        row = s.get(CompanionAsk, claim.id)
        wrote = wrote or bool(row and row.wrote)
    now = utcnow()
    final: str | None = None
    if code.startswith("fern_"):
        final = code  # the allowance ran out: asking again will not help
    elif wrote:
        final = "interrupted"
    elif claim.attempts >= MAX_ATTEMPTS:
        final = "reply_failed"
    if final is not None:
        _update(
            claim.id, status="failed", error=final, finished_at=now, lease_until=None
        )
        if not final.startswith("fern_"):
            sink(RunErrorEvent(message=ERRORS[final], code=final))
        runs.end(owner, run_id)
        publish(owner, "companion.reply", {"message_id": run_id, "failed": True})
        return False
    wait = _backoff(claim.attempts)
    _update(
        claim.id,
        status="queued",
        lease_until=None,
        not_before=now + timedelta(seconds=wait),
    )
    sink(CustomEvent(name="retry", value={"attempt": claim.attempts + 1}))
    runs.resting(owner, run_id)
    return False


def _turn(ctx: Ctx, claim: Claim, sink: runs.Sink, on_tool: Any) -> str | None:
    """The turn itself, on the person's own session. None when the reply is
    stored; else the failure's code."""
    run_id = str(claim.id)
    stream = turn.TurnStream(
        ctx,
        thread_id=f"companion:{ctx.user_id}",
        run_id=run_id,
        sink=sink,
        stop_check=lambda: gate.stop_requested(ctx.user_id, run_id),
    )
    stream.on_tool = on_tool
    # A message already answered (a resend whose events were dropped, or one
    # whose chat was cleared since) reads back what is stored, and nothing
    # after the reply (the push, the learning) runs again.
    asked = services.stored_question(ctx, claim.id)
    already = asked is not None and (
        asked.deleted_at is not None or services.stored_reply(ctx, claim.id) is not None
    )
    stream.started()
    try:
        with written.tracking(ctx.session) as wrote:
            stream.before_tool = lambda: wrote.fresh.clear()
            stream.after_tool = lambda: _send_written(ctx, stream, wrote)
            out = services.ask(
                ctx,
                text=claim.text,
                message_id=claim.id,
                stream=stream,
                media_ids=claim.media_ids,
                thread_id=claim.thread_id,
                resume=True,
            )
            ctx.commit()
    except HTTPException as exc:
        # The allowance ran out between the send and the turn (another
        # device): the app reads the code and shows the limit.
        detail: dict[str, Any] = exc.detail if isinstance(exc.detail, dict) else {}
        code = str(detail.get("code") or "")
        if exc.status_code != 402 or not code.startswith("fern_"):
            raise
        ctx.session.rollback()
        stream.failed(code, str(detail.get("message") or ""))
        return code
    out = out.model_copy(update={"changes": written.changes(ctx, wrote)})
    stream.finished(out.model_dump(mode="json"))
    sol = next((m for m in out.messages if m.role == "sol"), None)
    publish(
        ctx.user_id,
        "companion.reply",
        {
            "thread_id": str(claim.thread_id) if claim.thread_id else None,
            # The question's id, which the app knows the reply by.
            "message_id": run_id,
            "reply_id": str(sol.id) if sol else None,
        },
    )
    if not already:
        # A person who left the app hears that the reply is ready; one
        # still in the app sees it arrive.
        notify.reply_pushed(ctx, out, asked_at=claim.created_at)
    _update(claim.id, status="done", finished_at=utcnow(), lease_until=None)
    if not already:
        # The reply is out: what the turn teaches is learned now. A failure
        # here is logged and never reaches the finished reply.
        try:
            me = next((m for m in out.messages if m.role == "me"), None)
            if me is not None:
                _after_reply(ctx, claim.text, me.id, stream, claim.thread_id)
        except Exception as exc:  # noqa: BLE001 - after the reply, best effort
            ctx.session.rollback()
            log.warning("companion learn failed: %s", type(exc).__name__)
    runs.end(ctx.user_id, run_id)
    return None


def _send_written(ctx: Ctx, stream: turn.TurnStream, wrote: written.Wrote) -> None:
    """Send the synced rows a tool just wrote, committed, as a ``changes``
    event, and tell the person's other devices to pull.

    Kai, 2026-11-12: a meal Fern logged showed as saved in the chat but
    reached the Nutrition screen only when the reply ended, 1-12 s later
    (the model still writing). The commit is the one the next model call
    makes anyway (``capture.agent.call_model``), made a moment earlier so
    the app never shows a row that is not stored. Inside a batch or a
    savepoint (a capture interpreting) nothing is committed or sent: those
    rows ride on the finished reply as before."""
    if ctx.in_batch or ctx.session.in_nested_transaction():
        return
    ctx.session.flush()
    fresh = wrote.take_fresh()
    if not fresh:
        return
    release_connection(ctx.session)
    rows = written.changes(ctx, fresh)
    if not rows:
        return
    stream.custom("changes", {"changes": [r.model_dump(mode="json") for r in rows]})
    publish(ctx.user_id, "sync.changed", {"cursor": rows[-1].version})


def _after_reply(
    ctx: Ctx,
    text: str,
    me_id: uuid.UUID,
    stream: turn.TurnStream,
    thread_id: uuid.UUID | None,
) -> None:
    """Learning that waits until the reply is out (none of it delays a word):

    1. the message's pushback on the reply before it, and cards the person
       undid, become feedback signals (``feedback``);
    2. lasting facts and preferences in the message are kept, also on a
       turn that logged something (``services.learn``);
    3. waiting thumbs-down notes are learned from, for the person and, de-
       identified, for every Fern (``feedback.digest``);
    4. memories still without an embedding are embedded for recall, and
       older messages are folded into the chat's summary.
    """
    signal = feedback.record_turn_signal(ctx, me_id, text)
    feedback.record_undos(ctx, me_id)
    services.learn(
        ctx,
        text,
        # A memory saved this turn (asked for, or by the reply) has used
        # the message already; a write (a task, a meal) has not: a habit
        # said while logging is still worth keeping.
        already=any(s.ok and s.name == "remember_fact" for s in stream.steps),
        wrote=any(s.ok and s.name in services.WRITE_TOOLS for s in stream.steps),
        follows=signal[1].text if signal else None,
        pushback=signal is not None,
    )
    mems = " ".join(m.text for m in memory.live(ctx))
    feedback.digest(
        ctx,
        private=" ".join(
            [
                ctx.user.full_name or "",
                ctx.user.email,
                profile.get_profile(ctx).name or "",
                mems,
                text,
            ]
        ),
        learn=lambda words, reply: services.learn(
            ctx, words, already=False, follows=reply, pushback=True
        ),
    )
    memory.backfill(ctx, limit=20)
    ctx.commit()
    services.summarise_later(ctx, thread_id)
