"""Joint accounts: one person's finance account shared with others.

Decided 2026-11-28 (Kai: "decide for me"):

- The account stays its owner's ``account`` row, and every transaction on it
  is a ``fin_record`` in the OWNER's ledger. A member's transaction is
  written there by the server with ``logged_by`` set to the member, so the
  owner's phone gets it through its ordinary sync and the balance is the one
  ledger's balance for everyone.
- Members are ``shared_membership`` rows of kind ``account`` (the owner's
  own row has role ``owner``). Each member reads the account from their
  ``shared_member`` row (kind ``account``): a server-written snapshot with the
  balance, the newest ``RECORDS_IN_VIEW`` records (older ones page in over
  REST), the members and the owner's categories to log against.
- Only active members see the balance and records and log transactions.
  Only the owner shares, removes members, renames, archives or deletes (the
  last three are the owner's ordinary account edits). A member can leave.
  Anyone else gets ``account_not_found``.
- People join two ways: the owner invites someone they're connected with
  (``share``), who then accepts or declines through the shared-invite
  inbox (``respond``); or the owner hands out a single-use invite link
  (``app.modules.invites``, kind ``finance_account``), which works for
  anyone who holds it.

Keeping the snapshots current: every commit that touched a ``fin_record``,
``account`` or account ``shared_membership`` row rewrites the snapshots of
the joint accounts it touched (``_collect`` / ``_refresh_before_commit``),
whichever code path wrote it (REST, sync push, imports, jobs). A failure
there is logged and rolled back to a savepoint, never failing the write.
Bulk UPDATE statements are not seen; the next ordinary write catches up.
"""

import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import event, inspect, or_
from sqlalchemy.orm import Session as OrmSession
from sqlmodel import Session, col, func, select

from app.modules.dashboard import public as dashboard
from app.modules.finance import calc, repo
from app.modules.finance import public as finance
from app.modules.finance.models import Account, Category, FinRecord
from app.modules.iam.users.models import User
from app.modules.invites import registry as invites
from app.modules.invites.models import Invite
from app.modules.invites.schema import InviteSubject
from app.modules.shared_finance import groups
from app.modules.shared_finance import services as loans
from app.modules.shared_finance.models import (
    SharedEvent,
    SharedMember,
    SharedMembership,
)
from app.modules.shared_finance.schema import (
    GroupEventOut,
    JointCategoryOut,
    JointMemberOut,
    JointRecordArgs,
    JointRecordKind,
    JointRecordOut,
    JointRecordsOut,
    SharedAccountOut,
    SharedAccountsOut,
)
from app.modules.social import public as social
from app.shared.context import Ctx, make_ctx
from app.shared.currency import currency, money
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id
from app.shared.owned import utcnow

log = logging.getLogger(__name__)

KIND = "account"
INVITE_KIND = "finance_account"
RECORDS_IN_VIEW = 100
forbidden = loans.forbidden


def href(account_id: uuid.UUID) -> str:
    return f"/finance/shared/account/{account_id}"


# ---------------------------------------------------------------- lookups


def _memberships(session: Session, oid: uuid.UUID) -> list[SharedMembership]:
    return list(
        session.exec(
            select(SharedMembership)
            .where(
                SharedMembership.kind == KIND,
                SharedMembership.object_id == oid,
                col(SharedMembership.deleted_at).is_(None),
            )
            .order_by(col(SharedMembership.created_at), col(SharedMembership.id))
        ).all()
    )


def _account_row(
    ctx: Ctx, account_id: uuid.UUID, *, lock: bool = False
) -> Account | None:
    q = select(Account).where(
        Account.id == account_id,
        Account.tenant_id == ctx.tenant_id,
        col(Account.deleted_at).is_(None),
    )
    if lock:
        q = q.with_for_update()
    return ctx.session.exec(q).first()


def _visible(
    ctx: Ctx, account_id: uuid.UUID, *, lock: bool = False
) -> tuple[Account, list[SharedMembership], SharedMembership | None]:
    """The account, its memberships and mine. 404 unless I own it or I'm
    invited or active (the owner may not have shared it yet: ``me`` None)."""
    acc = _account_row(ctx, account_id, lock=lock)
    if acc is None:
        raise not_found("account")
    ms = _memberships(ctx.session, acc.id)
    me = groups._mine(ms, ctx.user_id)
    if acc.owner_id == ctx.user_id:
        return acc, ms, me
    if me is None or me.status not in ("invited", "active"):
        raise not_found("account")
    return acc, ms, me


def _owned(ctx: Ctx, account_id: uuid.UUID, *, lock: bool = False) -> Account:
    """My own account. A stranger gets the 404 of ``_visible``; a member
    who can see it gets 403 ``owner_only``."""
    acc, _, me = _visible(ctx, account_id, lock=lock)
    if acc.owner_id != ctx.user_id:
        raise forbidden("owner_only", "Only the account's owner can do that")
    return acc


def _active(acc: Account, me: SharedMembership | None, ctx: Ctx) -> None:
    if acc.owner_id == ctx.user_id:
        return
    if me is None or me.status != "active":
        raise forbidden("not_active_member", "Join it first")


def _owner_ctx(session: Session, acc: Account, now: Any = None) -> Ctx:
    owner = session.get(User, acc.owner_id)
    assert owner is not None
    return make_ctx(session, owner, now=now)


# ---------------------------------------------------------------- views


def _kind_of(r: FinRecord, acc_id: uuid.UUID) -> tuple[JointRecordKind, int]:
    if r.type == "transfer":
        if r.account_id == acc_id:
            return "transfer_out", -r.amount_minor
        return "transfer_in", r.amount_minor
    if r.type == "income":
        return "income", r.amount_minor
    return "expense", -r.amount_minor


def _records_where(acc: Account) -> list[Any]:
    return [
        FinRecord.owner_id == acc.owner_id,
        or_(
            col(FinRecord.account_id) == acc.id, col(FinRecord.to_account_id) == acc.id
        ),
        col(FinRecord.deleted_at).is_(None),
    ]


def _records_out(
    octx: Ctx, acc: Account, rows: list[FinRecord]
) -> list[JointRecordOut]:
    cats = {
        c.id: c
        for c in octx.session.exec(
            select(Category).where(Category.owner_id == acc.owner_id)
        ).all()
    }
    out: list[JointRecordOut] = []
    for r in rows:
        kind, signed = _kind_of(r, acc.id)
        c = cats.get(r.category_id) if r.category_id else None
        payee = r.payee
        if kind.startswith("transfer"):
            # The owner's other account stays private: only the direction.
            payee = "Transfer in" if kind == "transfer_in" else "Transfer out"
        out.append(
            JointRecordOut(
                id=r.id,
                kind=kind,
                amount_minor=r.amount_minor,
                signed_minor=signed,
                at=r.at,
                day=octx.clock.day_of(r.at),
                payee=payee,
                note=r.note,
                category_id=c.id if c else None,
                category_name=c.name if c else None,
                category_icon=c.icon if c else None,
                by_id=r.logged_by or acc.owner_id,
                is_adjustment=r.is_adjustment,
                pending=r.status == "pending",
            )
        )
    return out


def _base_view(
    session: Session, acc: Account, ms: list[SharedMembership]
) -> SharedAccountOut:
    """The view every member shares; ``role``/``my_status`` are the owner's
    and are rewritten per viewer."""
    octx = _owner_ctx(session, acc)
    state = repo.load_state(octx)
    balance = calc.balance_of(state, repo.acct_of(acc))
    where = _records_where(acc)
    rows = list(
        session.exec(
            select(FinRecord)
            .where(*where)
            .order_by(col(FinRecord.at).desc(), col(FinRecord.id))
            .limit(RECORDS_IN_VIEW)
        ).all()
    )
    total = session.exec(
        select(func.count()).select_from(FinRecord).where(*where)
    ).one()
    briefs = social.briefs(octx, [acc.owner_id, *[m.owner_id for m in ms]])
    owner_m = next((m for m in ms if m.owner_id == acc.owner_id), None)
    events = list(
        session.exec(
            select(SharedEvent)
            .where(SharedEvent.object_kind == KIND, SharedEvent.object_id == acc.id)
            .order_by(col(SharedEvent.at).desc(), col(SharedEvent.created_at))
            .limit(50)
        ).all()
    )
    return SharedAccountOut(
        id=acc.id,
        role="owner",
        my_status="active",
        name=acc.name,
        type=acc.type,
        color=acc.color,
        currency=octx.currency.code,
        archived=acc.archived,
        in_net_worth=acc.in_net_worth,
        balance_minor=balance,
        owner=loans._person(briefs, acc.owner_id),
        members=[
            JointMemberOut(
                person=loans._person(briefs, m.owner_id),
                role="owner" if m.role == "owner" else "member",
                status=m.status,  # type: ignore[arg-type]
            )
            for m in ms
            if m.status in ("invited", "active")
        ],
        records=_records_out(octx, acc, rows),
        records_total=int(total),
        categories=[
            JointCategoryOut(
                id=c.id,
                name=c.name,
                icon=c.icon,
                kind="income" if c.kind == "income" else "expense",
                parent_id=c.parent_id,
            )
            for c in finance.list_categories(octx)
            if not c.system
        ],
        events=[
            GroupEventOut(
                kind=e.kind,
                at=e.at,
                actor_id=e.owner_id,
                entry_id=None,
                amount_minor=e.amount_minor,
                text=e.text,
            )
            for e in events
        ],
        shared_at=owner_m.created_at if owner_m else acc.created_at,
    )


def _for(
    view: SharedAccountOut, acc: Account, m: SharedMembership | None
) -> SharedAccountOut:
    if m is None or m.owner_id == acc.owner_id:
        return view
    v = view.model_copy(update={"role": "member", "my_status": m.status})
    if m.status != "active":
        # Invited: who and what, not the money yet.
        v = v.model_copy(
            update={
                "balance_minor": 0,
                "records": [],
                "records_total": 0,
                "categories": [],
                "events": [],
            }
        )
    return v


def account_view(ctx: Ctx, *, account_id: uuid.UUID) -> SharedAccountOut:
    acc, ms, me = _visible(ctx, account_id)
    return _for(_base_view(ctx.session, acc, ms), acc, me)


def list_accounts(ctx: Ctx) -> SharedAccountsOut:
    """Joint accounts I own (shared with someone) or am invited to / in."""
    mine = ctx.session.exec(
        select(SharedMembership).where(
            SharedMembership.owner_id == ctx.user_id,
            SharedMembership.kind == KIND,
            col(SharedMembership.status).in_(("invited", "active")),
            col(SharedMembership.deleted_at).is_(None),
        )
    ).all()
    out: list[SharedAccountOut] = []
    for m in mine:
        acc = _account_row(ctx, m.object_id)
        if acc is None:
            continue
        ms = _memberships(ctx.session, acc.id)
        if acc.owner_id == ctx.user_id and not any(
            x.status in ("invited", "active") and x.owner_id != ctx.user_id for x in ms
        ):
            continue
        out.append(_for(_base_view(ctx.session, acc, ms), acc, m))
    out.sort(key=lambda v: v.shared_at, reverse=True)
    return SharedAccountsOut(data=out)


def list_records(
    ctx: Ctx, *, account_id: uuid.UUID, skip: int, limit: int
) -> JointRecordsOut:
    acc, _, me = _visible(ctx, account_id)
    _active(acc, me, ctx)
    where = _records_where(acc)
    rows = list(
        ctx.session.exec(
            select(FinRecord)
            .where(*where)
            .order_by(col(FinRecord.at).desc(), col(FinRecord.id))
            .offset(skip)
            .limit(limit)
        ).all()
    )
    total = ctx.session.exec(
        select(func.count()).select_from(FinRecord).where(*where)
    ).one()
    octx = _owner_ctx(ctx.session, acc)
    return JointRecordsOut(data=_records_out(octx, acc, rows), count=int(total))


# ---------------------------------------------------------------- snapshots


def member_id(user_id: uuid.UUID, oid: uuid.UUID) -> uuid.UUID:
    return derived_id("shared-member", user_id, f"{KIND}:{oid}")


def refresh(session: Session, account_ids: set[uuid.UUID]) -> None:
    """Rewrite every member's synced view of these joint accounts. An
    account with no memberships is not joint: nothing to do."""
    if not account_ids:
        return
    held_ms = list(
        session.exec(
            select(SharedMembership).where(
                SharedMembership.kind == KIND,
                col(SharedMembership.object_id).in_(account_ids),
                col(SharedMembership.deleted_at).is_(None),
            )
        ).all()
    )
    now = utcnow()
    for oid in {m.object_id for m in held_ms}:
        ms = sorted(
            (m for m in held_ms if m.object_id == oid),
            key=lambda m: (m.created_at, m.id),
        )
        acc = session.get(Account, oid)
        alive = acc is not None and acc.deleted_at is None
        view = _base_view(session, acc, ms) if alive and acc is not None else None
        for m in ms:
            rid = member_id(m.owner_id, oid)
            held = session.get(SharedMember, rid)
            keep = view is not None and m.status in ("invited", "active")
            if not keep:
                if held is not None and held.deleted_at is None:
                    held.status = m.status
                    held.deleted_at = now
                    held.updated_at = now
                    session.add(held)
                continue
            assert acc is not None and view is not None
            data = _for(view, acc, m).model_dump(mode="json")
            if held is None:
                held = SharedMember(
                    id=rid,
                    owner_id=m.owner_id,
                    tenant_id=acc.tenant_id,
                    kind=KIND,
                    object_id=oid,
                    role=m.role,
                    status=m.status,
                    data=data,
                )
            else:
                held.role = m.role
                held.status = m.status
                held.data = data
                held.updated_at = now
                held.deleted_at = None
            session.add(held)
    session.flush()


_TOUCHED = "joint_accounts_touched"
_BUSY = "joint_accounts_refreshing"


@event.listens_for(OrmSession, "after_flush")
def _collect(session: OrmSession, _flush: Any) -> None:
    if session.info.get(_BUSY):
        return
    ids: set[uuid.UUID] = set()
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, FinRecord):
            ins = inspect(obj)
            if ins is None:
                continue
            for attr in ("account_id", "to_account_id"):
                h = ins.attrs[attr].history
                ids.update(v for v in (*h.added, *h.unchanged, *h.deleted) if v)
        elif isinstance(obj, Account):
            ids.add(obj.id)
        elif isinstance(obj, SharedMembership) and obj.kind == KIND:
            ids.add(obj.object_id)
    if ids:
        session.info.setdefault(_TOUCHED, set()).update(ids)


@event.listens_for(OrmSession, "before_commit")
def _refresh_before_commit(session: OrmSession) -> None:
    if session.info.get(_BUSY):
        return
    session.flush()
    ids = session.info.pop(_TOUCHED, None)
    if not ids:
        return
    session.info[_BUSY] = True
    try:
        with session.begin_nested():
            refresh(session, ids)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001 - a stale view must never fail the write
        log.exception("joint account views not refreshed")
    finally:
        session.info.pop(_BUSY, None)


@event.listens_for(OrmSession, "after_rollback")
def _forget(session: OrmSession) -> None:
    session.info.pop(_TOUCHED, None)


# ---------------------------------------------------------------- events, notices


def _event(
    ctx: Ctx,
    oid: uuid.UUID,
    what: str,
    *,
    amount_minor: int | None = None,
    text: str | None = None,
) -> None:
    ctx.session.add(
        SharedEvent(
            **ctx.owned(),
            object_kind=KIND,
            object_id=oid,
            kind=what,
            at=ctx.now,
            amount_minor=amount_minor,
            text=text[:280] if text else None,
        )
    )


def _notify(
    ctx: Ctx,
    acc: Account,
    recipients: list[uuid.UUID],
    *,
    key: str,
    title: str,
    body: str = "",
    push: bool = True,
) -> None:
    for r in dict.fromkeys(recipients):
        if r == ctx.user_id:
            continue
        dashboard.notify(
            ctx,
            kind="social",
            title=title,
            body=body,
            href=href(acc.id),
            dedupe_key=f"{KIND}:{acc.id}:{key}"[:120],
            push=push,
            recipient_id=r,
        )


def _others(ms: list[SharedMembership], ctx: Ctx) -> list[uuid.UUID]:
    return [
        m.owner_id for m in ms if m.owner_id != ctx.user_id and m.status == "active"
    ]


def _ensure_owner(ctx: Ctx, acc: Account, ms: list[SharedMembership]) -> None:
    if any(m.owner_id == acc.owner_id for m in ms):
        return
    m = SharedMembership(
        owner_id=acc.owner_id,
        tenant_id=acc.tenant_id,
        kind=KIND,
        object_id=acc.id,
        role="owner",
        status="active",
        joined_at=ctx.now,
    )
    ctx.session.add(m)
    ms.insert(0, m)


def _join(
    ctx: Ctx, acc: Account, ms: list[SharedMembership], user_id: uuid.UUID, status: str
) -> SharedMembership:
    held = groups._mine(ms, user_id)
    if held is None:
        held = SharedMembership(
            owner_id=user_id,
            tenant_id=acc.tenant_id,
            kind=KIND,
            object_id=acc.id,
            role="member",
            status=status,
        )
        ms.append(held)
    else:
        held.status = status
    if status == "active":
        held.joined_at = ctx.now
    ctx.session.add(held)
    return held


# ---------------------------------------------------------------- use cases


def share(
    ctx: Ctx, *, account_id: uuid.UUID, member_ids: list[uuid.UUID]
) -> SharedAccountOut:
    """The owner invites people they're connected with."""
    acc = _owned(ctx, account_id, lock=True)
    if acc.archived:
        raise conflict("account_archived", "Unarchive it before sharing it")
    ids = groups._members(ctx, member_ids)
    ms = _memberships(ctx.session, acc.id)
    _ensure_owner(ctx, acc, ms)
    new: list[uuid.UUID] = []
    for uid in ids:
        held = groups._mine(ms, uid)
        if held is not None and held.status in ("invited", "active"):
            continue
        _join(ctx, acc, ms, uid, "invited")
        new.append(uid)
    if new:
        _event(ctx, acc.id, "invited", text=", ".join(loans._name(ctx, u) for u in new))
        _notify(
            ctx,
            acc,
            new,
            key=f"invited:{ctx.now.isoformat()}",
            title=f"{loans._name(ctx, ctx.user_id)} invited you to a joint account: {acc.name}",
            body="Join it to see the balance and add transactions together",
        )
    ctx.commit()
    return account_view(ctx, account_id=acc.id)


def respond(ctx: Ctx, *, account_id: uuid.UUID, accept: bool) -> str:
    """Accept or decline an invitation from the owner."""
    acc, ms, me = _visible(ctx, account_id, lock=True)
    if me is None or acc.owner_id == ctx.user_id:
        raise conflict("already_answered", "You already answered this")
    target = "active" if accept else "declined"
    if me.status == target:
        return target
    if me.status != "invited":
        raise conflict("already_answered", "You already answered this")
    _join(ctx, acc, ms, ctx.user_id, target)
    _event(ctx, acc.id, "joined" if accept else "declined")
    who = loans._name(ctx, ctx.user_id)
    _notify(
        ctx,
        acc,
        _others(ms, ctx),
        key=f"answer:{ctx.user_id}:{ctx.now.isoformat()}",
        title=f"{who} joined {acc.name}" if accept else f"{who} declined {acc.name}",
    )
    ctx.commit()
    return target


def leave(ctx: Ctx, *, account_id: uuid.UUID) -> str:
    acc, ms, me = _visible(ctx, account_id, lock=True)
    if acc.owner_id == ctx.user_id:
        raise conflict("owner_cannot_leave", "It's your account: remove people instead")
    assert me is not None
    me.status = "left"
    ctx.session.add(me)
    _event(ctx, acc.id, "left")
    _notify(
        ctx,
        acc,
        _others(ms, ctx),
        key=f"left:{ctx.user_id}:{ctx.now.isoformat()}",
        title=f"{loans._name(ctx, ctx.user_id)} left {acc.name}",
        push=False,
    )
    ctx.commit()
    return "left"


def remove_member(
    ctx: Ctx, *, account_id: uuid.UUID, user_id: uuid.UUID
) -> SharedAccountOut:
    acc = _owned(ctx, account_id, lock=True)
    ms = _memberships(ctx.session, acc.id)
    m = groups._mine(ms, user_id)
    if user_id == ctx.user_id:
        raise conflict("owner_cannot_leave", "It's your account")
    if m is None or m.status not in ("invited", "active"):
        raise not_found("member")
    m.status = "left"
    ctx.session.add(m)
    _event(ctx, acc.id, "removed", text=loans._name(ctx, user_id))
    _notify(
        ctx,
        acc,
        [user_id],
        key=f"removed:{user_id}:{ctx.now.isoformat()}",
        title=f"{loans._name(ctx, ctx.user_id)} removed you from {acc.name}",
        push=False,
    )
    ctx.commit()
    return account_view(ctx, account_id=acc.id)


def add_record(ctx: Ctx, *, data: JointRecordArgs) -> SharedAccountOut:
    """An active member (or the owner) logs an expense or income. It goes
    into the owner's ledger, marked with who logged it."""
    acc, ms, me = _visible(ctx, data.account_id, lock=True)
    _active(acc, me, ctx)
    if data.id is not None:
        held = ctx.session.get(FinRecord, data.id)
        if held is not None:
            mine = held.logged_by == ctx.user_id or (
                held.logged_by is None and held.owner_id == ctx.user_id
            )
            if not mine or held.account_id != acc.id:
                raise conflict("id_conflict", "That id is already in use")
            return account_view(ctx, account_id=acc.id)
    if acc.archived:
        raise conflict("account_archived", "This account is archived")
    if data.on_date > ctx.today + timedelta(days=1):
        raise invalid("paid_in_future", "That date hasn't come yet")
    octx = _owner_ctx(ctx.session, acc, now=ctx.now)
    if data.category_id is not None:
        ok = {c.id for c in finance.list_categories(octx) if c.kind == data.type}
        if data.category_id not in ok:
            raise not_found("category")
    at = (
        ctx.now
        if data.on_date == ctx.today
        else ctx.clock.local_time(data.on_date, "12:00")
    )
    rid = data.id or uuid.uuid4()
    payee = (data.payee or "").strip() or None
    note = (data.note or "").strip() or None
    if data.type == "expense":
        rec = finance.log_expense(
            octx,
            amount_minor=data.amount_minor,
            category_id=data.category_id,
            account_id=acc.id,
            payee=payee,
            note=note,
            source="manual",
            at=at,
            record_id=rid,
        )
    else:
        rec = finance.log_income(
            octx,
            amount_minor=data.amount_minor,
            category_id=data.category_id,
            account_id=acc.id,
            payee=payee,
            note=note,
            source="manual",
            at=at,
            record_id=rid,
        )
    if acc.owner_id != ctx.user_id:
        rec.logged_by = ctx.user_id
        ctx.session.add(rec)
    _event(ctx, acc.id, "recorded", amount_minor=data.amount_minor, text=payee)
    amt = money(data.amount_minor, currency(octx.currency.code))
    who = loans._name(ctx, ctx.user_id)
    _notify(
        ctx,
        acc,
        [*_others(ms, ctx), acc.owner_id],
        key=f"record:{rec.id}",
        title=f"{who} logged {'+' if data.type == 'income' else ''}{amt} in {acc.name}",
        body=payee or "",
        push=False,
    )
    ctx.commit()
    return account_view(ctx, account_id=acc.id)


# ---------------------------------------------------------------- invite links


def _invite_check(ctx: Ctx, object_id: uuid.UUID) -> None:
    acc = _owned(ctx, object_id)
    if acc.archived:
        raise conflict("account_archived", "Unarchive it before sharing it")


def _invite_describe(ctx: Ctx, inv: Invite) -> InviteSubject:
    acc = _account_row(ctx, inv.object_id)
    if acc is None or acc.owner_id != inv.owner_id:
        raise not_found("account")
    return InviteSubject(
        title=acc.name,
        label="Joint account",
        points=[
            "You'll see its balance and every transaction, and who logged it",
            "You can add transactions to it",
            "Its balance counts in your net worth",
            f"{loans._name(ctx, acc.owner_id)} keeps it: only they rename, archive or remove people. You can leave any time",
        ],
        href=href(acc.id),
    )


def _invite_is_member(ctx: Ctx, object_id: uuid.UUID) -> bool:
    m = ctx.session.exec(
        select(SharedMembership).where(
            SharedMembership.kind == KIND,
            SharedMembership.object_id == object_id,
            SharedMembership.owner_id == ctx.user_id,
            SharedMembership.status == "active",
            col(SharedMembership.deleted_at).is_(None),
        )
    ).first()
    return m is not None


def _invite_accept(ctx: Ctx, inv: Invite) -> None:
    acc = _account_row(ctx, inv.object_id, lock=True)
    if acc is None or acc.owner_id != inv.owner_id:
        raise not_found("account")
    if acc.archived:
        raise conflict("account_archived", "This account is archived")
    ms = _memberships(ctx.session, acc.id)
    _ensure_owner(ctx, acc, ms)
    _join(ctx, acc, ms, ctx.user_id, "active")
    _event(ctx, acc.id, "joined", text="link")
    _notify(
        ctx,
        acc,
        _others(ms, ctx),
        key=f"answer:{ctx.user_id}:{ctx.now.isoformat()}",
        title=f"{loans._name(ctx, ctx.user_id)} joined {acc.name} with your link",
    )
    ctx.session.flush()


invites.register(
    invites.InviteKind(
        name=INVITE_KIND,
        check_inviter=_invite_check,
        describe=_invite_describe,
        is_member=_invite_is_member,
        accept=_invite_accept,
    )
)


# ---------------------------------------------------------------- read contract


def joint_balances(ctx: Ctx) -> list[dict[str, Any]]:
    """Joint accounts I'm an active MEMBER of (not my own: those are in my
    ledger already), from my synced views: name, owner, balance, currency,
    whether it counts in net worth."""
    rows = ctx.session.exec(
        select(SharedMember).where(
            SharedMember.owner_id == ctx.user_id,
            SharedMember.kind == KIND,
            SharedMember.role == "member",
            SharedMember.status == "active",
            col(SharedMember.deleted_at).is_(None),
        )
    ).all()
    out: list[dict[str, Any]] = []
    for r in rows:
        d: dict[str, Any] = dict(r.data)
        owner = d.get("owner")
        out.append(
            {
                "name": str(d.get("name", "")),
                "owner": str(owner.get("name", "")) if isinstance(owner, dict) else "",
                "balance_minor": int(d.get("balance_minor", 0)),
                "currency": str(d.get("currency", "PHP")),
                "in_net_worth": bool(d.get("in_net_worth", True))
                and not bool(d.get("archived", False)),
            }
        )
    return out
