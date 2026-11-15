"""Shared savings goals and shared budgets: one function per screen action,
each ending with ``ctx.commit()``.

Who may do what:

- only members (invited or active) see a goal or budget; anyone else gets a
  natural 404 (``goal_not_found`` / ``budget_not_found``);
- only an active member puts money in, asks to take money out, or answers
  someone else's withdrawal. Nobody answers their own withdrawal (403
  ``not_your_call``), and a withdrawal waits for another member;
- accounts and categories must be the caller's own.

A goal's balance is the sum of accepted entries, never a stored number.
A budget's spending is each active member's own expenses this month in the
categories they chose, read from their own ledger. Each member's ledger gets
its own records (a deposit is an expense from their account, an accepted
withdrawal is income into it), linked from the entry.
"""

import uuid
from datetime import date, timedelta
from typing import Any, Literal

from sqlmodel import col, select

from app.modules.dashboard import public as dashboard
from app.modules.finance import public as finance
from app.modules.iam.users.models import User
from app.modules.shared_finance import services as loans
from app.modules.shared_finance.models import (
    GoalEntry,
    SharedBudget,
    SharedEvent,
    SharedGoal,
    SharedMember,
    SharedMembership,
)
from app.modules.shared_finance.schema import (
    BudgetCreate,
    BudgetOut,
    EntryCreate,
    EntryOut,
    GoalCreate,
    GoalOut,
    GroupEventOut,
    GroupsOut,
    MemberOut,
)
from app.modules.social import public as social
from app.shared.context import Ctx, make_ctx
from app.shared.currency import currency, money
from app.shared.domain import conflict, invalid, not_found
from app.shared.ids import derived_id

Kind = Literal["goal", "budget"]
Group = SharedGoal | SharedBudget
THRESHOLDS = (80, 100)
forbidden = loans.forbidden


# ---------------------------------------------------------------- lookups


def _model(kind: Kind) -> type[SharedGoal] | type[SharedBudget]:
    return SharedGoal if kind == "goal" else SharedBudget


def _memberships(ctx: Ctx, kind: Kind, oid: uuid.UUID) -> list[SharedMembership]:
    return list(
        ctx.session.exec(
            select(SharedMembership)
            .where(
                SharedMembership.kind == kind,
                SharedMembership.object_id == oid,
                SharedMembership.tenant_id == ctx.tenant_id,
                col(SharedMembership.deleted_at).is_(None),
            )
            .order_by(col(SharedMembership.created_at), col(SharedMembership.id))
        ).all()
    )


def _mine(ms: list[SharedMembership], user_id: uuid.UUID) -> SharedMembership | None:
    return next((m for m in ms if m.owner_id == user_id), None)


def _group(
    ctx: Ctx, kind: Kind, oid: uuid.UUID, *, lock: bool = False
) -> tuple[Any, list[SharedMembership], SharedMembership]:
    """The group, its members and mine; 404 unless I'm invited or active."""
    model = _model(kind)
    q = select(model).where(
        model.id == oid,
        model.tenant_id == ctx.tenant_id,
        col(model.deleted_at).is_(None),
    )
    if lock:
        q = q.with_for_update()
    row = ctx.session.exec(q).first()
    ms = _memberships(ctx, kind, oid) if row is not None else []
    me = _mine(ms, ctx.user_id)
    if row is None or me is None or me.status not in ("invited", "active"):
        raise not_found(kind)
    return row, ms, me


def _active(me: SharedMembership) -> None:
    if me.status != "active":
        raise forbidden("not_active_member", "Join it first")


def _entries(ctx: Ctx, goal_id: uuid.UUID) -> list[GoalEntry]:
    return list(
        ctx.session.exec(
            select(GoalEntry)
            .where(GoalEntry.goal_id == goal_id, col(GoalEntry.deleted_at).is_(None))
            .order_by(col(GoalEntry.created_at), col(GoalEntry.id))
        ).all()
    )


def _events(ctx: Ctx, kind: Kind, oid: uuid.UUID) -> list[SharedEvent]:
    return list(
        ctx.session.exec(
            select(SharedEvent)
            .where(SharedEvent.object_kind == kind, SharedEvent.object_id == oid)
            .order_by(col(SharedEvent.at), col(SharedEvent.created_at))
        ).all()
    )


def _balance(entries: list[GoalEntry]) -> tuple[int, int]:
    """(balance, withdrawals still waiting)."""
    bal = sum(
        e.amount_minor if e.kind == "deposit" else -e.amount_minor
        for e in entries
        if e.status == "accepted"
    )
    pending = sum(
        e.amount_minor
        for e in entries
        if e.kind == "withdrawal" and e.status == "sent"
    )
    return bal, pending


def _user(ctx: Ctx, user_id: uuid.UUID) -> User:
    return social.person(ctx, user_id)


def _ctx_of(ctx: Ctx, user_id: uuid.UUID) -> Ctx:
    if user_id == ctx.user_id:
        return ctx
    return make_ctx(ctx.session, _user(ctx, user_id), now=ctx.now)


def _own_categories(ctx: Ctx, ids: list[uuid.UUID]) -> list[str]:
    if not ids:
        return []
    mine = {c.id for c in finance.list_categories(ctx) if c.kind == "expense"}
    if not set(ids) <= mine:
        raise not_found("category")
    return [str(i) for i in dict.fromkeys(ids)]


# ---------------------------------------------------------------- views


def _month(ctx: Ctx) -> tuple[str, date, date]:
    first = ctx.today.replace(day=1)
    nxt = (first + timedelta(days=32)).replace(day=1)
    return first.strftime("%Y-%m"), first, nxt - timedelta(days=1)


def member_spend(ctx: Ctx, m: SharedMembership) -> int:
    """What ``m`` spent this month in the categories they chose."""
    mctx = _ctx_of(ctx, m.owner_id)
    _, first, last = _month(mctx)
    cats = [uuid.UUID(c) for c in m.category_ids] or None
    return finance.spend_between(mctx, first, last, cats)


def _members_out(
    ms: list[SharedMembership],
    briefs: dict[uuid.UUID, Any],
    amounts: dict[uuid.UUID, int],
) -> list[MemberOut]:
    return [
        MemberOut(
            person=loans._person(briefs, m.owner_id),
            role=m.role,  # type: ignore[arg-type]
            status=m.status,  # type: ignore[arg-type]
            amount_minor=amounts.get(m.owner_id, 0),
        )
        for m in ms
        if m.status in ("invited", "active")
    ]


def _events_out(events: list[SharedEvent]) -> list[GroupEventOut]:
    return [
        GroupEventOut(
            kind=e.kind,
            at=e.at,
            actor_id=e.owner_id,
            entry_id=e.entry_id,
            amount_minor=e.amount_minor,
            text=e.text,
        )
        for e in events
    ]


def goal_out(
    ctx: Ctx,
    goal: SharedGoal,
    ms: list[SharedMembership],
    viewer: uuid.UUID,
) -> GoalOut:
    entries = _entries(ctx, goal.id)
    bal, pending = _balance(entries)
    per: dict[uuid.UUID, int] = {}
    for e in entries:
        if e.status == "accepted":
            sign = 1 if e.kind == "deposit" else -1
            per[e.owner_id] = per.get(e.owner_id, 0) + sign * e.amount_minor
    me = _mine(ms, viewer)
    assert me is not None
    briefs = social.briefs(ctx, [m.owner_id for m in ms])
    return GoalOut(
        id=goal.id,
        role=me.role,  # type: ignore[arg-type]
        my_status=me.status,  # type: ignore[arg-type]
        status=goal.status,  # type: ignore[arg-type]
        name=goal.name,
        currency=goal.currency,
        target_minor=goal.target_minor,
        deadline=goal.deadline,
        balance_minor=bal,
        pending_minor=pending,
        members=_members_out(ms, briefs, per),
        entries=[
            EntryOut(
                id=e.id,
                kind=e.kind,  # type: ignore[arg-type]
                status=e.status,  # type: ignore[arg-type]
                amount_minor=e.amount_minor,
                on_date=e.on_date,
                note=e.note,
                by_id=e.owner_id,
                account_id=e.account_id if e.owner_id == viewer else None,
                record_id=e.record_id if e.owner_id == viewer else None,
                decided_at=e.decided_at,
                decided_by=e.decided_by,
                reason=e.reason,
                created_at=e.created_at,
            )
            for e in entries
        ],
        events=_events_out(_events(ctx, "goal", goal.id)),
        created_at=goal.created_at,
    )


def budget_out(
    ctx: Ctx,
    budget: SharedBudget,
    ms: list[SharedMembership],
    viewer: uuid.UUID,
) -> BudgetOut:
    spent = {m.owner_id: member_spend(ctx, m) for m in ms if m.status == "active"}
    me = _mine(ms, viewer)
    assert me is not None
    month, _, _ = _month(ctx)
    briefs = social.briefs(ctx, [m.owner_id for m in ms])
    return BudgetOut(
        id=budget.id,
        role=me.role,  # type: ignore[arg-type]
        my_status=me.status,  # type: ignore[arg-type]
        status=budget.status,  # type: ignore[arg-type]
        name=budget.name,
        currency=budget.currency,
        limit_minor=budget.limit_minor,
        month=month,
        spent_minor=sum(spent.values()),
        my_category_ids=[uuid.UUID(c) for c in me.category_ids],
        members=_members_out(ms, briefs, spent),
        events=_events_out(_events(ctx, "budget", budget.id)),
        created_at=budget.created_at,
    )


def _out(ctx: Ctx, kind: Kind, row: Any, ms: list[SharedMembership]) -> Any:
    if kind == "goal":
        return goal_out(ctx, row, ms, ctx.user_id)
    return budget_out(ctx, row, ms, ctx.user_id)


def list_groups(ctx: Ctx) -> GroupsOut:
    mine = ctx.session.exec(
        select(SharedMembership).where(
            SharedMembership.owner_id == ctx.user_id,
            col(SharedMembership.status).in_(("invited", "active")),
            col(SharedMembership.deleted_at).is_(None),
        )
    ).all()
    goals: list[GoalOut] = []
    budgets: list[BudgetOut] = []
    for m in mine:
        kind: Kind = "goal" if m.kind == "goal" else "budget"
        row, ms, _ = _group(ctx, kind, m.object_id)
        if kind == "goal":
            goals.append(goal_out(ctx, row, ms, ctx.user_id))
        else:
            budgets.append(budget_out(ctx, row, ms, ctx.user_id))
    goals.sort(key=lambda g: g.created_at, reverse=True)
    budgets.sort(key=lambda b: b.created_at, reverse=True)
    return GroupsOut(goals=goals, budgets=budgets)


def get_goal(ctx: Ctx, *, goal_id: uuid.UUID) -> GoalOut:
    row, ms, _ = _group(ctx, "goal", goal_id)
    return goal_out(ctx, row, ms, ctx.user_id)


def get_budget(ctx: Ctx, *, budget_id: uuid.UUID) -> BudgetOut:
    row, ms, _ = _group(ctx, "budget", budget_id)
    return budget_out(ctx, row, ms, ctx.user_id)


# ---------------------------------------------------------------- side effects


def member_id(user_id: uuid.UUID, kind: Kind, oid: uuid.UUID) -> uuid.UUID:
    return derived_id("shared-member", user_id, f"{kind}:{oid}")


def refresh_members(ctx: Ctx, kind: Kind, row: Any) -> None:
    """Rewrite every member's synced view; a member who declined or left
    loses theirs."""
    ctx.session.flush()
    ms = _memberships(ctx, kind, row.id)
    for m in ms:
        rid = member_id(m.owner_id, kind, row.id)
        held = ctx.session.get(SharedMember, rid)
        if m.status in ("invited", "active"):
            data = _out(_ctx_of(ctx, m.owner_id), kind, row, ms).model_dump(
                mode="json"
            )
            gone = None
        else:
            data, gone = (held.data if held else {}), ctx.now
        if held is None:
            if gone is not None:
                continue
            held = SharedMember(
                id=rid,
                owner_id=m.owner_id,
                tenant_id=row.tenant_id,
                kind=kind,
                object_id=row.id,
                role=m.role,
                status=m.status,
                data=data,
            )
        else:
            held.status = m.status
            held.data = data
            held.updated_at = ctx.now
            held.deleted_at = gone
        ctx.session.add(held)
    ctx.session.flush()


def _event(
    ctx: Ctx,
    kind: Kind,
    oid: uuid.UUID,
    what: str,
    *,
    entry: GoalEntry | None = None,
    amount_minor: int | None = None,
    text: str | None = None,
) -> None:
    ctx.session.add(
        SharedEvent(
            **ctx.owned(),
            object_kind=kind,
            object_id=oid,
            entry_id=entry.id if entry else None,
            kind=what,
            at=ctx.now,
            amount_minor=amount_minor,
            text=text[:280] if text else None,
        )
    )


def _notify(
    ctx: Ctx,
    kind: Kind,
    oid: uuid.UUID,
    recipients: list[uuid.UUID],
    *,
    key: str,
    title: str,
    body: str = "",
) -> None:
    for r in dict.fromkeys(recipients):
        if r == ctx.user_id:
            continue
        dashboard.notify(
            ctx,
            kind="social",
            title=title,
            body=body,
            href=f"/finance/shared/{kind}/{oid}",
            dedupe_key=f"{kind}:{oid}:{key}"[:120],
            push=True,
            recipient_id=r,
        )


def _others(ms: list[SharedMembership], ctx: Ctx, *, active: bool = True) -> list[uuid.UUID]:
    return [
        m.owner_id
        for m in ms
        if m.owner_id != ctx.user_id and (m.status == "active" or not active)
    ]


def _members(
    ctx: Ctx, ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    """Validate who to share with: real, not me, connected to me."""
    out = list(dict.fromkeys(ids))
    for uid in out:
        if uid == ctx.user_id:
            raise invalid("self_member", "You're already in it")
        social.person(ctx, uid)
        if not social.connected(ctx, ctx.user_id, uid):
            raise forbidden("not_connected", "Follow them (or have them follow you) first")
    return out


def _amount(cur: str, minor: int) -> str:
    return money(minor, currency(cur))


# ---------------------------------------------------------------- create, join


def _create(
    ctx: Ctx,
    kind: Kind,
    row: Any,
    member_ids: list[uuid.UUID],
    my_categories: list[str],
    title: str,
) -> None:
    ctx.session.add(row)
    ctx.session.flush()
    ctx.session.add(
        SharedMembership(
            **ctx.owned(),
            kind=kind,
            object_id=row.id,
            role="owner",
            status="active",
            category_ids=my_categories,
            joined_at=ctx.now,
        )
    )
    for uid in member_ids:
        ctx.session.add(
            SharedMembership(
                owner_id=uid,
                tenant_id=ctx.tenant_id,
                kind=kind,
                object_id=row.id,
                role="member",
                status="invited",
            )
        )
    _event(ctx, kind, row.id, "created")
    refresh_members(ctx, kind, row)
    _notify(
        ctx,
        kind,
        row.id,
        member_ids,
        key="invited",
        title=f"{loans._name(ctx, ctx.user_id)} {title}",
        body="Join it to see it together",
    )
    ctx.commit()


def _replay(ctx: Ctx, kind: Kind, oid: uuid.UUID | None) -> Any | None:
    if oid is None:
        return None
    held = ctx.session.get(_model(kind), oid)
    if held is None:
        return None
    if held.owner_id != ctx.user_id or held.tenant_id != ctx.tenant_id:
        raise conflict("id_conflict", "That id is already in use")
    return held


def create_goal(ctx: Ctx, *, data: GoalCreate) -> GoalOut:
    if _replay(ctx, "goal", data.id) is not None:
        assert data.id is not None
        return get_goal(ctx, goal_id=data.id)
    ids = _members(ctx, data.member_ids)
    goal = SharedGoal(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        name=data.name.strip(),
        target_minor=data.target_minor,
        deadline=data.deadline,
        currency=ctx.currency.code,
    )
    _create(ctx, "goal", goal, ids, [], f"started a shared goal: {goal.name}")
    return get_goal(ctx, goal_id=goal.id)


def create_budget(ctx: Ctx, *, data: BudgetCreate) -> BudgetOut:
    if _replay(ctx, "budget", data.id) is not None:
        assert data.id is not None
        return get_budget(ctx, budget_id=data.id)
    ids = _members(ctx, data.member_ids)
    cats = _own_categories(ctx, data.category_ids)
    budget = SharedBudget(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        name=data.name.strip(),
        limit_minor=data.limit_minor,
        currency=ctx.currency.code,
    )
    _create(
        ctx,
        "budget",
        budget,
        ids,
        cats,
        f"shared a budget with you: {budget.name}",
    )
    return get_budget(ctx, budget_id=budget.id)


def respond(
    ctx: Ctx,
    *,
    kind: Kind,
    object_id: uuid.UUID,
    accept: bool,
    category_ids: list[uuid.UUID],
) -> str:
    """Join or decline an invite; returns the new membership status."""
    row, ms, me = _group(ctx, kind, object_id, lock=True)
    target = "active" if accept else "declined"
    if me.status == target:
        return target
    if me.status != "invited":
        raise conflict("already_answered", "You already answered this")
    me.status = target
    if accept:
        me.joined_at = ctx.now
        if kind == "budget":
            me.category_ids = _own_categories(ctx, category_ids)
    ctx.session.add(me)
    _event(ctx, kind, row.id, "joined" if accept else "declined")
    refresh_members(ctx, kind, row)
    who = loans._name(ctx, ctx.user_id)
    _notify(
        ctx,
        kind,
        row.id,
        _others(ms, ctx),
        key=f"answer:{ctx.user_id}",
        title=f"{who} joined {row.name}" if accept else f"{who} declined {row.name}",
    )
    ctx.commit()
    return target


def set_categories(
    ctx: Ctx, *, budget_id: uuid.UUID, category_ids: list[uuid.UUID]
) -> BudgetOut:
    row, ms, me = _group(ctx, "budget", budget_id, lock=True)
    _active(me)
    cats = _own_categories(ctx, category_ids)
    if cats != me.category_ids:
        me.category_ids = cats
        ctx.session.add(me)
        _event(ctx, "budget", row.id, "categories_set")
        refresh_members(ctx, "budget", row)
        check_thresholds(ctx, row)
    ctx.commit()
    return get_budget(ctx, budget_id=row.id)


# ---------------------------------------------------------------- goal money


def add_entry(ctx: Ctx, *, data: EntryCreate) -> GoalOut:
    goal, ms, me = _group(ctx, "goal", data.goal_id, lock=True)
    _active(me)
    if data.id is not None:
        held = ctx.session.get(GoalEntry, data.id)
        if held is not None:
            if held.owner_id != ctx.user_id or held.goal_id != goal.id:
                raise conflict("id_conflict", "That id is already in use")
            return get_goal(ctx, goal_id=goal.id)
    if goal.status != "active":
        raise conflict("goal_closed", "This goal is closed")
    if data.on_date > ctx.today + timedelta(days=1):
        raise invalid("paid_in_future", "That date hasn't come yet")
    finance.require_account(ctx, data.account_id)
    e = GoalEntry(
        **ctx.owned(),
        id=data.id or uuid.uuid4(),
        goal_id=goal.id,
        kind=data.kind,
        amount_minor=data.amount_minor,
        on_date=data.on_date,
        note=(data.note or "").strip() or None,
        account_id=data.account_id,
    )
    me_name = loans._name(ctx, ctx.user_id)
    if data.kind == "deposit":
        e.status = "accepted"
        e.decided_at = ctx.now
        e.decided_by = ctx.user_id
        ctx.session.add(e)
        ctx.session.flush()
        e.record_id = finance.log_expense(
            ctx,
            amount_minor=e.amount_minor,
            account_id=data.account_id,
            payee=goal.name,
            note=" · ".join(x for x in ("Into shared goal", e.note) if x),
            source="manual",
            at=ctx.now if e.on_date == ctx.today else ctx.clock.local_time(e.on_date, "12:00"),
            record_id=derived_id("goal-entry", e.id, "record"),
        ).id
        ctx.session.add(e)
        _event(ctx, "goal", goal.id, "deposited", entry=e, amount_minor=e.amount_minor)
        refresh_members(ctx, "goal", goal)
        bal, _ = _balance(_entries(ctx, goal.id))
        reached = goal.target_minor is not None and bal >= goal.target_minor
        _notify(
            ctx,
            "goal",
            goal.id,
            _others(ms, ctx),
            key=f"entry:{e.id}",
            title=(
                f"{goal.name} reached its target"
                if reached
                else f"{me_name} put {_amount(goal.currency, e.amount_minor)} into {goal.name}"
            ),
            body=f"{_amount(goal.currency, bal)} saved together",
        )
    else:
        others = _others(ms, ctx)
        if not others:
            raise conflict(
                "no_one_to_confirm", "Someone else has to join before money comes out"
            )
        bal, pending = _balance(_entries(ctx, goal.id))
        if e.amount_minor > bal - pending:
            raise invalid("over_balance", "That's more than the goal holds")
        e.status = "sent"
        ctx.session.add(e)
        ctx.session.flush()
        _event(
            ctx, "goal", goal.id, "withdrawal_sent", entry=e, amount_minor=e.amount_minor
        )
        refresh_members(ctx, "goal", goal)
        _notify(
            ctx,
            "goal",
            goal.id,
            others,
            key=f"entry:{e.id}",
            title=f"{me_name} wants to take {_amount(goal.currency, e.amount_minor)} out of {goal.name}",
            body=e.note or "Accept or reject it",
        )
    ctx.commit()
    return get_goal(ctx, goal_id=goal.id)


def _entry(ctx: Ctx, goal: SharedGoal, entry_id: uuid.UUID) -> GoalEntry:
    e = ctx.session.exec(
        select(GoalEntry)
        .where(
            GoalEntry.id == entry_id,
            GoalEntry.goal_id == goal.id,
            col(GoalEntry.deleted_at).is_(None),
        )
        .with_for_update()
    ).first()
    if e is None:
        raise not_found("entry")
    return e


def withdraw_entry(ctx: Ctx, *, goal_id: uuid.UUID, entry_id: uuid.UUID) -> GoalOut:
    goal, ms, me = _group(ctx, "goal", goal_id, lock=True)
    e = _entry(ctx, goal, entry_id)
    if e.owner_id != ctx.user_id:
        raise forbidden("not_your_entry", "Only who asked can take it back")
    if e.status == "withdrawn":
        return get_goal(ctx, goal_id=goal.id)
    if e.status != "sent":
        raise conflict("entry_already_decided", "That was already answered")
    e.status = "withdrawn"
    e.decided_at = ctx.now
    e.decided_by = ctx.user_id
    ctx.session.add(e)
    _event(
        ctx, "goal", goal.id, "withdrawal_withdrawn", entry=e, amount_minor=e.amount_minor
    )
    refresh_members(ctx, "goal", goal)
    ctx.commit()
    return get_goal(ctx, goal_id=goal.id)


def decide_entry(
    ctx: Ctx,
    *,
    goal_id: uuid.UUID,
    entry_id: uuid.UUID,
    accept: bool,
    reason: str | None,
) -> GoalOut:
    """Another active member accepts (the money lands in the asker's own
    account) or rejects a withdrawal. The same answer again is a no-op."""
    goal, ms, me = _group(ctx, "goal", goal_id, lock=True)
    _active(me)
    e = _entry(ctx, goal, entry_id)
    if e.owner_id == ctx.user_id:
        raise forbidden("not_your_call", "Someone else confirms your withdrawal")
    want = "accepted" if accept else "rejected"
    if e.status == want:
        return get_goal(ctx, goal_id=goal.id)
    if e.status != "sent":
        raise conflict("entry_already_decided", "That was already answered")
    if accept:
        actx = _ctx_of(ctx, e.owner_id)
        if e.account_id is not None and finance.get_account(actx, e.account_id):
            e.record_id = finance.log_income(
                actx,
                amount_minor=e.amount_minor,
                account_id=e.account_id,
                payee=goal.name,
                note=" · ".join(x for x in ("Out of shared goal", e.note) if x),
                source="manual",
                at=ctx.now,
                record_id=derived_id("goal-entry", e.id, "record"),
            ).id
    else:
        text = (reason or "").strip()
        if not text:
            raise invalid("reason_required", "Say why, so they know")
        e.reason = text
    e.status = want
    e.decided_at = ctx.now
    e.decided_by = ctx.user_id
    ctx.session.add(e)
    _event(
        ctx,
        "goal",
        goal.id,
        "withdrawal_accepted" if accept else "withdrawal_rejected",
        entry=e,
        amount_minor=e.amount_minor,
        text=e.reason,
    )
    refresh_members(ctx, "goal", goal)
    who = loans._name(ctx, ctx.user_id)
    amt = _amount(goal.currency, e.amount_minor)
    _notify(
        ctx,
        "goal",
        goal.id,
        [e.owner_id],
        key=f"decided:{e.id}",
        title=f"{who} okayed taking {amt} out" if accept else f"{who} didn't okay taking {amt} out",
        body=goal.name if accept else (e.reason or ""),
    )
    ctx.commit()
    return get_goal(ctx, goal_id=goal.id)


# ---------------------------------------------------------------- budget alerts


def check_thresholds(ctx: Ctx, budget: SharedBudget) -> list[int]:
    """Tell every active member once a month when the budget passes 80% and
    100%. Returns the thresholds newly announced."""
    ms = _memberships(ctx, "budget", budget.id)
    active = [m for m in ms if m.status == "active"]
    spent = sum(member_spend(ctx, m) for m in active)
    month, _, _ = _month(ctx)
    hit: list[int] = []
    for pct in THRESHOLDS:
        if spent * 100 < budget.limit_minor * pct:
            continue
        sent = False
        for m in active:
            row = dashboard.notify(
                ctx,
                kind="social",
                title=(
                    f"{budget.name} is used up"
                    if pct == 100
                    else f"{budget.name} is {pct}% spent"
                ),
                body=f"{_amount(budget.currency, spent)} of {_amount(budget.currency, budget.limit_minor)} this month",
                href=f"/finance/shared/budget/{budget.id}",
                dedupe_key=f"budget:{budget.id}:{month}:{pct}",
                push=True,
                recipient_id=m.owner_id,
            )
            sent = sent or row is not None
        if sent:
            _event(ctx, "budget", budget.id, "threshold", amount_minor=spent, text=f"{pct}%")
            hit.append(pct)
    return hit


def refresh_budget(ctx: Ctx, budget: SharedBudget) -> list[int]:
    """The job's step for one budget: members' views and the alerts."""
    refresh_members(ctx, "budget", budget)
    hit = check_thresholds(ctx, budget)
    if hit:
        refresh_members(ctx, "budget", budget)
    return hit
