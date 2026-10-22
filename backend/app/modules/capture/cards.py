"""Record cards: built from drafts, tiered, saved, undone, redone, edited,
answered (prototype ``engine.ts``).

Every state change appends a ``card_write_log`` row. A save runs inside a
SAVEPOINT: when the owning module refuses (a deleted account, a routine
already running), the partial write rolls back and the card keeps a warning
instead of a half-written record.
"""

import re
import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import col, func, select

from app.modules.capture import execute as X
from app.modules.capture import ports, rules
from app.modules.capture.journal import settings_row
from app.modules.capture.models import (
    Capture,
    CaptureAttachment,
    CardWriteLog,
    RecordCard,
    ReplyItem,
)
from app.modules.capture.parse import (
    Draft,
    InfoDraft,
    QuestionDraft,
    RecordDraft,
    js_num,
    js_round,
)
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.currency import money
from app.shared.day import js_weekday
from app.shared.domain import conflict, invalid

TARGET_OF = {
    "expense": "finance",
    "income": "finance",
    "transfer": "finance",
    "planned": "finance",
    "command": "finance",
    "task": "tasks",
    "taskComplete": "tasks",
    "habitLog": "habits",
    "habitCreate": "habits",
    "routineStart": "habits",
    "workout": "fitness",
    "weighIn": "fitness",
    "meal": "fitness",
    "photo": "fitness",
    "journal": "journal",
    "accountCreate": "finance",
    "accountBalance": "finance",
    "routineUpdate": "habits",
    "habitUpdate": "habits",
    "budgetCreate": "finance",
    "routineCreate": "habits",
    "templateCreate": "fitness",
    "listCreate": "tasks",
}
SAVE_FAILED = "Couldn't save — try again or edit."
# Refusals a person can act on: the owning module's code and its message,
# shown on the card in place of SAVE_FAILED. Any other refusal stays generic.
REFUSALS = {"no_account": "Add an account first"}
CHANGED_SINCE = "Changed or deleted since — open the entry instead."
SKIPPED = "Skipped — waiting in History until you answer."
SAVES = ("saved", "edited", "redone")


# ---------------------------------------------------------------- reads


def require_card(ctx: Ctx, card_id: uuid.UUID) -> RecordCard:
    return owned_repo.require(ctx, RecordCard, card_id, what="card")


def require_capture(ctx: Ctx, capture_id: uuid.UUID) -> Capture:
    return owned_repo.require(ctx, Capture, capture_id, what="capture")


def cards_of(ctx: Ctx, capture_id: uuid.UUID) -> list[RecordCard]:
    return owned_repo.list_rows(
        ctx,
        RecordCard,
        col(RecordCard.capture_id) == capture_id,
        order_by=[col(RecordCard.position)],
    )


def replies_of(ctx: Ctx, capture_id: uuid.UUID) -> list[ReplyItem]:
    return owned_repo.list_rows(
        ctx,
        ReplyItem,
        col(ReplyItem.capture_id) == capture_id,
        order_by=[col(ReplyItem.position)],
    )


def log_of(ctx: Ctx, card_id: uuid.UUID) -> list[CardWriteLog]:
    return owned_repo.list_rows(
        ctx,
        CardWriteLog,
        col(CardWriteLog.card_id) == card_id,
        order_by=[col(CardWriteLog.at), col(CardWriteLog.created_at)],
    )


def photo_media(ctx: Ctx, capture_id: uuid.UUID) -> uuid.UUID | None:
    att = owned_repo.find_one(
        ctx,
        CaptureAttachment,
        col(CaptureAttachment.capture_id) == capture_id,
        col(CaptureAttachment.kind) == "image",
    )
    return att.media_id if att else None


def _generation(ctx: Ctx, card_id: uuid.UUID) -> int:
    n = ctx.session.exec(
        select(func.count())
        .select_from(CardWriteLog)
        .where(
            CardWriteLog.owner_id == ctx.user_id,
            CardWriteLog.card_id == card_id,
            col(CardWriteLog.action).in_(SAVES),
        )
    ).one()
    return int(n)


def _meta(ctx: Ctx, card: RecordCard) -> dict[str, Any]:
    """The draft's rule and parser flag, kept on the "proposed" log row so a
    card answered later is tiered by the same rules."""
    first = ctx.session.exec(
        select(CardWriteLog.after).where(
            CardWriteLog.owner_id == ctx.user_id,
            CardWriteLog.card_id == card.id,
            CardWriteLog.action == "proposed",
        )
    ).first()
    return dict(first or {})


# ---------------------------------------------------------------- writes


def _log(
    ctx: Ctx,
    card: RecordCard,
    action: str,
    actor: str,
    *,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    owned_repo.insert(
        ctx,
        CardWriteLog,
        {
            "card_id": card.id,
            "at": ctx.now,
            "action": action,
            "actor": actor,
            "before": before,
            "after": after,
        },
    )


def _snap(card: RecordCard) -> dict[str, Any]:
    return {"payload": card.payload, "refs": list(card.refs), "state": card.state}


def refresh_status(ctx: Ctx, cap: Capture) -> None:
    if cap.status not in ("done", "answered", "needs_input"):
        return
    views = [rules.ItemView("record", c.state) for c in cards_of(ctx, cap.id)]
    views += [
        rules.ItemView(
            "answer" if r.kind == "answer" else "info", tone=str(r.body.get("tone"))
        )
        for r in replies_of(ctx, cap.id)
    ]
    cap.status = rules.status_of(views)
    ctx.session.add(cap)
    ctx.session.flush()


def _last_written(ctx: Ctx, *, exclude: uuid.UUID | None = None) -> RecordCard | None:
    """The newest saved card (the prototype's ``lastMoneyCard``: any kind
    but a command), the target of "change that to 300"."""
    q = (
        select(RecordCard)
        .join(Capture, col(Capture.id) == col(RecordCard.capture_id))
        .where(
            RecordCard.owner_id == ctx.user_id,
            RecordCard.tenant_id == ctx.tenant_id,
            col(RecordCard.deleted_at).is_(None),
            col(Capture.deleted_at).is_(None),
            col(RecordCard.state).in_(tuple(rules.WRITTEN)),
            RecordCard.kind != "command",
        )
        .order_by(col(Capture.at).desc(), col(RecordCard.position).desc())
        .limit(1)
    )
    if exclude is not None:
        q = q.where(RecordCard.capture_id != exclude)
    return ctx.session.exec(q).first()


def new_card(
    ctx: Ctx,
    cap: Capture,
    d: RecordDraft,
    *,
    position: int,
    actor: str = "ai",
    settings: Any = None,
) -> RecordCard:
    """Persist a draft as a card with its tier (``fromDraft``). Flushes."""
    st = settings or settings_row(ctx)
    payload = dict(d.payload)
    warn = d.warn
    force = False
    if payload.get("kind") == "command":
        last = _last_written(ctx, exclude=cap.id)
        payload["record_id"] = str(last.id) if last else None
        warn = None if last else "I couldn't find a recent entry to change."
        if last is None:
            payload.pop("record_id", None)
    if payload.get("kind") == "expense" and payload.get("amount_minor"):
        dup = ports.duplicate_expense(
            ctx, amount_minor=int(payload["amount_minor"]), at=cap.at
        )
        if dup is not None:
            at, payee = dup
            when = at.astimezone(ctx.clock.zone)
            clock = f"{when.hour % 12 or 12}:{when.minute:02d} {'am' if when.hour < 12 else 'pm'}"
            warn = (
                f"Looks like the {money(int(payload['amount_minor']), ctx.currency)} you logged at "
                f"{clock}{f' ({payee})' if payee else ''}. Keep both?"
            )
            force = True
    tier = rules.tier_for(
        rule=d.rule,
        payload=payload,
        confirm=True if force else d.confirm,
        source=cap.source,
        rules=st.rules,
        money_threshold_minor=st.money_threshold_minor,
    )
    card = owned_repo.insert(
        ctx,
        RecordCard,
        {
            "capture_id": cap.id,
            "position": position,
            "kind": d.kind,
            "target": d.target,
            "tier": tier,
            "state": "needs_input" if d.ask else "proposed",
            "payload": payload,
            "refs": [],
            "ask": d.ask,
            "warn": warn,
            "confidence": max(0.0, min(1.0, d.confidence))
            if d.confidence is not None
            else None,
            "day_offset": d.day_offset,
        },
    )
    _log(
        ctx,
        card,
        "proposed",
        actor,
        after={"rule": d.rule, "confirm": bool(d.confirm or force), "payload": payload},
    )
    return card


def new_reply(
    ctx: Ctx, cap: Capture, kind: str, body: dict[str, Any], *, position: int
) -> ReplyItem:
    return owned_repo.insert(
        ctx,
        ReplyItem,
        {"capture_id": cap.id, "position": position, "kind": kind, "body": body},
    )


@dataclass
class Refusal:
    code: str
    message: str

    def error(self) -> HTTPException:
        return invalid(self.code, self.message)


GENERIC = Refusal("card_save_failed", SAVE_FAILED)
# Every warning a refusal leaves on a card; a later save clears these and
# keeps any other warning the card was drafted with.
REFUSAL_WARNS = frozenset({SAVE_FAILED, *REFUSALS.values()})


def refusal_of(exc: Exception) -> Refusal:
    detail = exc.detail if isinstance(exc, HTTPException) else None
    code = detail.get("code") if isinstance(detail, dict) else None
    if isinstance(code, str) and code in REFUSALS:
        return Refusal(code, REFUSALS[code])
    return GENERIC


def save(
    ctx: Ctx, card: RecordCard, cap: Capture, *, actor: str, action: str = "saved"
) -> bool:
    """Write the card into its module. ``False`` (with a warning on the card)
    when the module refused; nothing of the attempt is kept then."""
    return try_save(ctx, card, cap, actor=actor, action=action) is None


def try_save(
    ctx: Ctx, card: RecordCard, cap: Capture, *, actor: str, action: str = "saved"
) -> Refusal | None:
    """:func:`save`, returning why the module refused (``None`` when saved)."""
    before = _snap(card)
    gen = _generation(ctx, card.id)
    ctx.session.add(card)
    ctx.session.flush()
    sp = ctx.session.begin_nested()
    try:
        if card.payload.get("kind") == "command":
            res = _run_command(ctx, card, cap)
        else:
            res = X.execute(
                ctx, card, cap, gen=gen, photo_media_id=photo_media(ctx, cap.id)
            )
        sp.commit()
    except (HTTPException, ValueError, KeyError, SQLAlchemyError) as exc:
        sp.rollback()
        ctx.session.refresh(card)
        why = refusal_of(exc)
        card.warn = why.message
        ctx.session.add(card)
        ctx.session.flush()
        return why
    card.refs = res.refs
    card.prior = res.prior
    card.note = res.note or card.note
    card.state = "saved"
    card.ask = None
    if card.warn in REFUSAL_WARNS:
        card.warn = None
    ctx.session.add(card)
    ctx.session.flush()
    _log(ctx, card, action, actor, before=before, after=_snap(card))
    return None


def _run_command(ctx: Ctx, card: RecordCard, cap: Capture) -> X.Result:
    del cap
    target_id = card.payload.get("record_id")
    target = (
        owned_repo.get(ctx, RecordCard, uuid.UUID(str(target_id)))
        if target_id
        else None
    )
    if target is None or target.state not in rules.WRITTEN:
        raise invalid("command_target_missing", "Nothing recent to change")
    tcap = require_capture(ctx, target.capture_id)
    if card.payload.get("op") == "delete":
        _revert_written(ctx, target, tcap, actor="user")
        return X.Result([str(target.id)], prior={"op": "delete"})
    amount: Any = card.payload.get("amount_minor")
    if amount is None or "amount_minor" not in target.payload:
        raise invalid("command_not_editable", "That entry has no amount to change")
    old = dict(target.payload)
    _edit_written(ctx, target, tcap, {**old, "amount_minor": int(amount)}, actor="user")
    return X.Result([str(target.id)], prior={"op": "edit", "payload": old})


def _revert_written(ctx: Ctx, card: RecordCard, cap: Capture, *, actor: str) -> None:
    before = _snap(card)
    if card.payload.get("kind") == "command":
        _undo_command(ctx, card)
    else:
        X.revert(ctx, card)
    card.state = "undone"
    ctx.session.add(card)
    ctx.session.flush()
    _log(ctx, card, "undone", actor, before=before, after=_snap(card))
    refresh_status(ctx, cap)


def _undo_command(ctx: Ctx, card: RecordCard) -> None:
    prior: dict[str, Any] = dict(card.prior or {})
    target = (
        owned_repo.get(ctx, RecordCard, uuid.UUID(card.refs[0])) if card.refs else None
    )
    if target is None:
        return
    tcap = require_capture(ctx, target.capture_id)
    if prior.get("op") == "delete" and target.state == "undone":
        if not save(ctx, target, tcap, actor="user", action="redone"):
            raise conflict("card_changed_since", CHANGED_SINCE)
    elif prior.get("op") == "edit" and target.state in rules.WRITTEN:
        _edit_written(ctx, target, tcap, dict(prior["payload"]), actor="user")


def _edit_written(
    ctx: Ctx, card: RecordCard, cap: Capture, payload: dict[str, Any], *, actor: str
) -> None:
    X.revert(ctx, card)
    before = _snap(card)
    card.payload = payload
    card.kind = str(payload["kind"])
    card.target = TARGET_OF.get(card.kind, card.target)
    gen = _generation(ctx, card.id)
    res = X.execute(ctx, card, cap, gen=gen, photo_media_id=photo_media(ctx, cap.id))
    card.refs, card.prior, card.note = res.refs, res.prior, res.note or card.note
    card.state, card.warn = "edited", None
    ctx.session.add(card)
    ctx.session.flush()
    _log(ctx, card, "edited", actor, before=before, after=_snap(card))


def _require(card: RecordCard, op: str) -> None:
    if not rules.allowed(card.state, op):
        raise conflict(
            "card_state", "This card can't do that right now", {"state": card.state}
        )


# ---------------------------------------------------------------- use cases


def confirm_row(ctx: Ctx, card: RecordCard, *, actor: str = "user") -> RecordCard:
    """Flush-only confirm (shared by confirm, confirm-all and sync)."""
    if card.state in rules.WRITTEN:
        return card  # a replayed confirm is a no-op
    _require(card, "confirm")
    cap = require_capture(ctx, card.capture_id)
    save(ctx, card, cap, actor=actor)
    refresh_status(ctx, cap)
    return card


def confirm(ctx: Ctx, *, card_id: uuid.UUID) -> RecordCard:
    card = confirm_row(ctx, require_card(ctx, card_id))
    ctx.commit()
    return card


def confirm_all(ctx: Ctx, *, capture_id: uuid.UUID) -> list[RecordCard]:
    cap = require_capture(ctx, capture_id)
    out = []
    for c in cards_of(ctx, cap.id):
        if c.state == "proposed":
            confirm_row(ctx, c)
        out.append(c)
    ctx.commit()
    return out


def discard_row(ctx: Ctx, card: RecordCard) -> RecordCard:
    if card.state == "discarded":
        return card
    _require(card, "discard")
    before = _snap(card)
    card.state, card.ask = "discarded", None
    ctx.session.add(card)
    ctx.session.flush()
    _log(ctx, card, "discarded", "user", before=before, after=_snap(card))
    refresh_status(ctx, require_capture(ctx, card.capture_id))
    return card


def discard(ctx: Ctx, *, card_id: uuid.UUID) -> RecordCard:
    card = discard_row(ctx, require_card(ctx, card_id))
    ctx.commit()
    return card


def undo_row(ctx: Ctx, card: RecordCard, *, actor: str = "user") -> RecordCard:
    if card.state == "undone":
        return card
    _require(card, "undo")
    cap = require_capture(ctx, card.capture_id)
    sp = ctx.session.begin_nested()
    try:
        _revert_written(ctx, card, cap, actor=actor)
        sp.commit()
    except HTTPException as exc:
        sp.rollback()
        ctx.session.refresh(card)
        card.warn = CHANGED_SINCE
        ctx.session.add(card)
        ctx.session.flush()
        raise conflict("card_changed_since", CHANGED_SINCE) from exc
    return card


def undo(ctx: Ctx, *, card_id: uuid.UUID) -> RecordCard:
    card = require_card(ctx, card_id)
    try:
        undo_row(ctx, card)
    except HTTPException:
        ctx.commit()  # keep the warning on the card
        raise
    ctx.commit()
    return card


def redo_row(ctx: Ctx, card: RecordCard) -> RecordCard:
    if card.state in rules.WRITTEN:
        return card
    _require(card, "redo")
    cap = require_capture(ctx, card.capture_id)
    why = try_save(ctx, card, cap, actor="user", action="redone")
    if why is not None:
        raise why.error()
    refresh_status(ctx, cap)
    return card


def redo(ctx: Ctx, *, card_id: uuid.UUID) -> RecordCard:
    card = require_card(ctx, card_id)
    try:
        redo_row(ctx, card)
    except HTTPException:
        ctx.commit()
        raise
    ctx.commit()
    return card


def edit_row(ctx: Ctx, card: RecordCard, payload: dict[str, Any]) -> RecordCard:
    _require(card, "edit")
    cap = require_capture(ctx, card.capture_id)
    if card.state in rules.WRITTEN:
        sp = ctx.session.begin_nested()
        try:
            _edit_written(ctx, card, cap, payload, actor="user")
            sp.commit()
        except HTTPException as exc:
            sp.rollback()
            ctx.session.refresh(card)
            raise refusal_of(exc).error() from exc
    else:
        before = _snap(card)
        card.payload = payload
        card.kind = str(payload["kind"])
        card.target = TARGET_OF.get(card.kind, card.target)
        card.warn = None
        ctx.session.add(card)
        ctx.session.flush()
        _log(ctx, card, "edited", "user", before=before, after=_snap(card))
    refresh_status(ctx, cap)
    return card


def edit(ctx: Ctx, *, card_id: uuid.UUID, payload: dict[str, Any]) -> RecordCard:
    card = edit_row(ctx, require_card(ctx, card_id), payload)
    ctx.commit()
    return card


def skip(ctx: Ctx, *, card_id: uuid.UUID) -> RecordCard:
    card = require_card(ctx, card_id)
    _require(card, "skip")
    card.warn = SKIPPED
    ctx.session.add(card)
    ctx.commit()
    return card


# ---------------------------------------------------------------- answers


def js_parse_float(s: str) -> float | None:
    m = re.match(r"\s*([+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)", s)
    return float(m.group(1)) if m else None


def _due_offset(ctx: Ctx, d: str) -> int:
    if d == "sat":
        return (6 - js_weekday(ctx.today) + 7) % 7 or 7
    try:
        return int(d)
    except ValueError:
        return 0


def _category_for(ctx: Ctx, value: str) -> tuple[str | None, str | None]:
    """(category id, note) for a follow-up answer: a chip's id, a category
    name, else "Shopping" with the words kept as the note."""
    world = ports.build_world(ctx)
    ids = set(world.category_slugs.values())
    if value in ids:
        return value, None
    hit = ports.finance.resolve_category(ctx, value)
    if hit is not None:
        return str(hit.id), None
    return world.category_slugs.get("shopping"), value


@dataclass
class Answered:
    card: RecordCard
    replaced: list[RecordCard]


def answer_row(ctx: Ctx, card: RecordCard, value: str) -> Answered:
    """``answerCard``: fill the asked field; an auto-tier card saves."""
    _require(card, "answer")
    if not card.ask:
        raise conflict("card_no_question", "This card has no question")
    cap = require_capture(ctx, card.capture_id)
    p: dict[str, Any] = dict(card.payload)
    field = str(card.ask.get("field"))
    kind = p.get("kind")
    before = _snap(card)
    if kind == "photo":
        from app.modules.capture import photo

        return Answered(card, photo.answer_hint(ctx, cap, card, value))
    if kind == "expense" and field == "category_id":
        cid, note = _category_for(ctx, value)
        p["category_id"] = cid
        if note:
            p["note"] = note
        if cid is None:
            p.pop("category_id", None)
    elif kind == "income" and field == "account_id":
        p["account_id"] = value
    elif kind == "transfer" and field in ("from", "to"):
        p[field] = value
        if not p.get("from") or not p.get("to"):
            missing = "from" if not p.get("from") else "to"
            opts = [
                o for o in ports.build_world(ctx).account_options if o["value"] != value
            ]
            card.payload = p
            card.ask = {
                "question": "To which account?"
                if missing == "to"
                else "From which account?",
                "field": missing,
                "options": opts,
            }
            ctx.session.add(card)
            ctx.session.flush()
            _log(ctx, card, "edited", "user", before=before, after=_snap(card))
            return Answered(card, [])
    elif kind == "taskComplete" and field == "task_id":
        p["task_id"] = value
    elif kind == "routineStart" and field == "routine_id":
        p["routine_id"] = value
    elif kind == "task" and field == "due":
        d, _, time = value.partition("|")
        day = (ctx.today + timedelta(days=_due_offset(ctx, d))).isoformat()
        p["tasks"] = [
            {
                **t,
                "due_date": t.get("due_date") or day,
                "due_time": t.get("due_time") or (time or None),
                "remind": True,
            }
            for t in p.get("tasks") or []
        ]
    elif kind == "meal" and field in ("rice", "servings"):
        n = js_parse_float(value) or 1
        items = []
        for it in p.get("items") or []:
            if field == "rice" and not re.search("rice", str(it.get("name")), re.I):
                items.append(it)
                continue
            f = n / (it.get("qty") or 1) if field == "rice" else n
            items.append(
                {
                    **it,
                    "qty": n if field == "rice" else it["qty"] * n,
                    "kcal": js_round(it["kcal"] * f),
                    "protein": js_round(it["protein"] * f),
                    "carbs": js_round(it["carbs"] * f),
                    "fat": js_round(it["fat"] * f),
                    "assumption": f"{value}, you said"
                    if field == "rice"
                    else f"{js_num(n)} serving{'' if n == 1 else 's'}",
                }
            )
        p["items"] = items
        p["confidence"] = min(0.95, float(p.get("confidence") or 0.5) + 0.1)
    elif kind == "habitLog" and field == "habit_id":
        p["habit_id"] = value
    elif kind == "meal":
        # A photo meal's own follow-up ("does the 160 g include bones?"):
        # the estimate is redone with the answer, never refused.
        from app.modules.capture import photo

        question = str(card.ask.get("question") or "")
        got = photo.refine_meal(ctx, list(p.get("items") or []), question, value)
        if got is not None:
            p["items"], conf = got
            p["confidence"] = min(0.95, max(conf, float(p.get("confidence") or 0)))
        else:
            items = list(p.get("items") or [])
            if items:
                note = f"{question} {value}".strip()[:200]
                items[0] = {**items[0], "assumption": note}
            p["items"] = items
    else:
        raise invalid("answer_not_understood", "That answer doesn't fit this question")
    meta = _meta(ctx, card)
    st = settings_row(ctx)
    card.payload = p
    card.ask = None
    card.state = "proposed"
    # Tiered again with the answer in: "paid 1500" + "Electricity" is a
    # complete expense under the threshold, which saves (IA J5).
    card.tier = rules.tier_for(
        rule=str(meta.get("rule") or kind),
        payload=p,
        confirm=bool(meta.get("confirm")),
        source=cap.source,
        rules=st.rules,
        money_threshold_minor=st.money_threshold_minor,
    )
    ctx.session.add(card)
    ctx.session.flush()
    _log(ctx, card, "edited", "user", before=before, after=_snap(card))
    if card.tier == "auto":
        save(ctx, card, cap, actor="user")
    refresh_status(ctx, cap)
    return Answered(card, [])


def answer(ctx: Ctx, *, card_id: uuid.UUID, value: str) -> Answered:
    out = answer_row(ctx, require_card(ctx, card_id), value)
    ctx.commit()
    return out


# ---------------------------------------------------------------- drafts


@dataclass
class Built:
    cards: list[RecordCard]
    replies: list[ReplyItem]


def add_drafts(
    ctx: Ctx,
    cap: Capture,
    drafts: list[Draft],
    *,
    answer_fn: Any,
    start: int = 0,
    auto_save: bool = True,
    actor: str = "ai",
) -> Built:
    """Persist drafts as cards and replies, then save the auto-tier cards."""
    st = settings_row(ctx)
    cards: list[RecordCard] = []
    replies: list[ReplyItem] = []
    for i, d in enumerate(drafts, start=start):
        if isinstance(d, RecordDraft):
            cards.append(new_card(ctx, cap, d, position=i, actor=actor, settings=st))
        elif isinstance(d, QuestionDraft):
            body = answer_fn(d.text)
            replies.append(new_reply(ctx, cap, str(body.get("t")), body, position=i))
        elif isinstance(d, InfoDraft):
            replies.append(
                new_reply(ctx, cap, "info", {"t": "info", **d.card}, position=i)
            )
    if auto_save:
        for c in cards:
            if c.tier == "auto" and c.state == "proposed":
                save(ctx, c, cap, actor=actor)
    return Built(cards, replies)
