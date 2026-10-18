"""Pure finance calculations, ported from ``shared/prototype/finance/calc.ts``
(plus ``reports.ts`` and ``review.ts``).

Everything here works on an in-memory :class:`State` snapshot and never
touches the database, so the same functions back the REST views, the stats
contributor, the advisor fallback and the golden-fixture tests.

Conventions:

- Amounts are integer centavos. Sums stay integers; a function that divides
  (an average, a share, a per-day allowance) returns a ``float`` and the caller
  rounds ONCE at the edge with :func:`js_round` (the prototype's
  ``Math.round``: half toward +infinity, never banker's rounding).
- Days are business days (``date``) already resolved by the caller through
  ``DayClock``; ``State.today`` is the user's today. Nothing here reads a clock.
- Ids are plain strings so the calculations run unchanged over the database
  (UUID strings) and over the prototype seed (slugs like ``"gcash"``).
- Lists keep the prototype's iteration order: ``State.records`` is sorted by
  timestamp, which decides ties in reconcile and category suggestion.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Literal

from app.shared.day import js_weekday

RecordType = Literal["expense", "income", "transfer"]
Direction = Literal["in", "out"]
OccStatus = Literal["paid", "skipped", "due", "upcoming", "overdue"]
Period = Literal["this", "last", "3m"]


def js_round(x: float) -> int:
    """JavaScript ``Math.round``: half rounds toward +infinity."""
    return math.floor(x + 0.5)


# ---------------------------------------------------------------------------
# Snapshot types
# ---------------------------------------------------------------------------


@dataclass
class Acct:
    id: str
    type: str
    opening: int
    in_net_worth: bool = True
    in_projection: bool = True
    archived: bool = False
    manual: bool = False
    name: str = ""
    last_reconciled: date | None = None


@dataclass
class Cat:
    id: str
    kind: str
    parent_id: str | None = None
    discretionary: bool = False
    archived: bool = False
    system: bool = False
    name: str = ""
    slug: str | None = None


@dataclass
class Rec:
    id: str
    type: str
    amount: int
    account_id: str
    day: date
    to_account_id: str | None = None
    category_id: str | None = None
    payee: str | None = None
    planned_id: str | None = None
    planned_on: date | None = None
    import_id: str | None = None
    is_refund: bool = False
    is_adjustment: bool = False
    source: str = "manual"
    status: str = "cleared"


@dataclass
class Bud:
    id: str
    name: str
    category_ids: list[str] | None
    limit: int
    rollover: bool = False
    start_date: date | None = None
    archived: bool = False


@dataclass
class Plan:
    id: str
    name: str
    type: str
    amount: int
    account_id: str
    schedule: dict[str, Any]
    start: date
    end_rule: dict[str, Any] = field(default_factory=lambda: {"kind": "never"})
    to_account_id: str | None = None
    category_id: str | None = None
    auto_log: bool = False
    is_what_if: bool = False
    in_projection: bool = True
    archived: bool = False
    estimated: bool = False
    skipped: set[date] = field(default_factory=set)
    snoozed: dict[date, date] = field(default_factory=dict)


@dataclass
class Settings:
    month_start_day: int = 1


@dataclass
class State:
    today: date
    accounts: list[Acct] = field(default_factory=list)
    categories: list[Cat] = field(default_factory=list)
    records: list[Rec] = field(default_factory=list)
    budgets: list[Bud] = field(default_factory=list)
    planned: list[Plan] = field(default_factory=list)
    settings: Settings = field(default_factory=Settings)
    # Seeded category slug -> this user's category id (the prototype's
    # RAW_HINTS name categories by slug).
    cat_by_slug: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Day and month keys
# ---------------------------------------------------------------------------


def parse_day(k: str) -> date:
    return date.fromisoformat(k)


def add_days(d: date, n: int) -> date:
    return d + timedelta(days=n)


def diff_days(a: date, b: date) -> int:
    return (a - b).days


def last_dom(y: int, m: int) -> int:
    """Days in month ``m`` (1-based) of year ``y``."""
    nxt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
    return (nxt - timedelta(days=1)).day


def _mk(y: int, m: int) -> str:
    return f"{y:04d}-{m:02d}"


def _split(mk: str) -> tuple[int, int]:
    y, m = mk.split("-")
    return int(y), int(m)


def month_of(d: date, start_day: int = 1) -> str:
    """The budget month a day belongs to with a custom month start day."""
    if d.day < start_day:
        y, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
        return _mk(y, m)
    return _mk(d.year, d.month)


def add_months(mk: str, n: int) -> str:
    y, m = _split(mk)
    idx = y * 12 + (m - 1) + n
    return _mk(idx // 12, idx % 12 + 1)


def month_range(mk: str, start_day: int = 1) -> tuple[date, date]:
    """``[from, to]`` of a budget month (``to`` is the day before the next
    month's start day)."""
    y, m = _split(mk)
    first = date(y, m, start_day)
    ny, nm = _split(add_months(mk, 1))
    to = date(ny, nm, 1) + timedelta(days=start_day - 2)
    return first, to


def month_index(mk: str, cur: str) -> int:
    y1, m1 = _split(mk)
    y0, m0 = _split(cur)
    return (y1 - y0) * 12 + (m1 - m0)


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def cat_map(s: State) -> dict[str, Cat]:
    return {c.id: c for c in s.categories}


def in_scope(cat_id: str | None, ids: list[str] | None, cats: dict[str, Cat]) -> bool:
    """A record's category is inside a budget's categories (or their children)."""
    if ids is None:
        return True
    if not cat_id:
        return False
    if cat_id in ids:
        return True
    c = cats.get(cat_id)
    parent = c.parent_id if c else None
    return bool(parent) and parent in ids


def top_cat(cat_id: str | None, cats: dict[str, Cat]) -> Cat | None:
    c = cats.get(cat_id) if cat_id else None
    if c is not None and c.parent_id:
        return cats.get(c.parent_id, c)
    return c


# ---------------------------------------------------------------------------
# Balances and net worth
# ---------------------------------------------------------------------------


def signed_for(r: Rec, acct: str) -> int:
    """A record's effect on one account. A credit card is a liability: its
    balance runs negative as spending is charged to it."""
    if r.type == "transfer":
        if r.account_id == acct:
            return -r.amount
        if r.to_account_id == acct:
            return r.amount
        return 0
    if r.account_id != acct:
        return 0
    return r.amount if r.type == "income" else -r.amount


def balance_of(s: State, acct: Acct, as_of: date | None = None) -> int:
    b = acct.opening
    for r in s.records:
        if as_of is not None and r.day > as_of:
            continue
        b += signed_for(r, acct.id)
    return b


def balances(s: State) -> dict[str, int]:
    out = {a.id: a.opening for a in s.accounts}
    for r in s.records:
        if r.type == "transfer":
            if r.account_id in out:
                out[r.account_id] -= r.amount
            if r.to_account_id and r.to_account_id in out:
                out[r.to_account_id] += r.amount
        elif r.account_id in out:
            out[r.account_id] += r.amount if r.type == "income" else -r.amount
    return out


def net_worth(s: State, bal: dict[str, int] | None = None) -> int:
    bal = balances(s) if bal is None else bal
    return sum(bal[a.id] for a in s.accounts if a.in_net_worth and not a.archived)


def liquid(
    s: State, bal: dict[str, int] | None = None, exclude: Iterable[str] = ()
) -> int:
    bal = balances(s) if bal is None else bal
    ex = set(exclude)
    return sum(
        bal[a.id]
        for a in s.accounts
        if a.in_projection and not a.archived and a.id not in ex
    )


def net_worth_series(s: State, days: int = 90) -> list[int]:
    t = s.today
    inc = [a for a in s.accounts if a.in_net_worth and not a.archived]
    nw = sum(a.opening for a in inc)
    by_day: dict[date, int] = {}
    for r in s.records:
        d = sum(signed_for(r, a.id) for a in inc)
        if not d:
            continue
        by_day[r.day] = by_day.get(r.day, 0) + d
    start = add_days(t, -(days - 1))
    for k, v in by_day.items():
        if k < start:
            nw += v
    out: list[int] = []
    for i in range(days):
        nw += by_day.get(add_days(start, i), 0)
        out.append(nw)
    return out


def account_series(s: State, acct: Acct, days: int = 60) -> list[int]:
    start = add_days(s.today, -(days - 1))
    b = acct.opening
    by_day: dict[date, int] = {}
    for r in s.records:
        v = signed_for(r, acct.id)
        if not v:
            continue
        if r.day < start:
            b += v
        else:
            by_day[r.day] = by_day.get(r.day, 0) + v
    out: list[int] = []
    for i in range(days):
        b += by_day.get(add_days(start, i), 0)
        out.append(b)
    return out


# ---------------------------------------------------------------------------
# Cash flow
# ---------------------------------------------------------------------------


def is_flow(r: Rec) -> bool:
    """Income and spending only: transfers and balance adjustments move or
    correct money, they are not earned or spent."""
    return r.type != "transfer" and not r.is_adjustment


@dataclass
class Flow:
    income: int = 0
    spend: int = 0
    by_cat: dict[str, int] = field(default_factory=dict)
    by_payee: dict[str, int] = field(default_factory=dict)
    count: int = 0


def flow_in(s: State, first: date, last: date) -> Flow:
    cats = cat_map(s)
    f = Flow()
    for r in s.records:
        if not is_flow(r) or r.day < first or r.day > last:
            continue
        f.count += 1
        if r.type == "income" and not r.is_refund:
            f.income += r.amount
            continue
        # A refund is income in the expense category: it reduces spend.
        v = r.amount if r.type == "expense" else -r.amount
        f.spend += v
        top = top_cat(r.category_id, cats)
        key = top.id if top else "uncat"
        f.by_cat[key] = f.by_cat.get(key, 0) + v
        if r.payee and r.type == "expense":
            f.by_payee[r.payee] = f.by_payee.get(r.payee, 0) + v
    return f


def savings_rate(f: Flow) -> float:
    return (f.income - f.spend) / f.income if f.income > 0 else 0.0


def spend_in(
    s: State,
    first: date,
    last: date,
    ids: list[str] | None,
    cats: dict[str, Cat] | None = None,
) -> int:
    cats = cat_map(s) if cats is None else cats
    v = 0
    for r in s.records:
        if not is_flow(r) or r.day < first or r.day > last:
            continue
        if r.type == "income" and not r.is_refund:
            continue
        if not in_scope(r.category_id, ids, cats):
            continue
        v += r.amount if r.type == "expense" else -r.amount
    return v


@dataclass
class NoSpend:
    days: list[tuple[date, bool]]
    count: int
    streak: int


def no_spend_days(s: State, first: date, last: date) -> NoSpend:
    """Days with no spending in a discretionary category (bills and planned
    items never break a no-spend day), up to today, plus the trailing streak."""
    cats = cat_map(s)
    spent: set[date] = set()
    for r in s.records:
        if r.type != "expense" or r.is_adjustment:
            continue
        c = cats.get(r.category_id or "")
        if c is None or not c.discretionary:
            continue
        spent.add(r.day)
    days: list[tuple[date, bool]] = []
    k = first
    while k <= last and k <= s.today:
        days.append((k, k not in spent))
        k = add_days(k, 1)
    streak = 0
    for _, free in reversed(days):
        if not free:
            break
        streak += 1
    return NoSpend(days=days, count=sum(1 for _, f in days if f), streak=streak)


# ---------------------------------------------------------------------------
# Budgets
# ---------------------------------------------------------------------------

# How far back a rollover chain is followed (a bound, not a business rule a
# person can see: two years of carried leftovers is the whole useful history).
ROLLOVER_MONTHS_MAX = 24


@dataclass
class BudgetView:
    budget: Bud
    month: str
    spent: int
    limit: int
    carry: int
    pct: float
    pace: float
    days_left: int
    safe_per_day: float
    first: date
    last: date


def rollover_carry(s: State, b: Bud, mk: str) -> int:
    """Unspent budget carried into month ``mk``.

    The prototype stores ``rollover`` but never computes it, so this is the
    server's ruling: when rollover is on, what is left of a month's limit
    (its own limit plus whatever it carried in) is added to the next month's
    limit, chained from the month of the budget's start date. Overspending
    is NOT carried as a debt (a blown month starts the next one at the plain
    limit); a carry is never negative.
    """
    if not b.rollover:
        return 0
    sd = s.settings.month_start_day
    start_mk = month_of(b.start_date, sd) if b.start_date else mk
    first_mk = max(start_mk, add_months(mk, -ROLLOVER_MONTHS_MAX))
    cats = cat_map(s)
    carry = 0
    m = first_mk
    while month_index(m, mk) < 0:
        f, t = month_range(m, sd)
        spent = spend_in(s, f, t, b.category_ids, cats)
        carry = max(0, b.limit + carry - spent)
        m = add_months(m, 1)
    return carry


def budget_view(s: State, b: Bud, mk: str | None = None) -> BudgetView:
    sd = s.settings.month_start_day
    t = s.today
    month = mk or month_of(t, sd)
    first, last = month_range(month, sd)
    spent = spend_in(s, first, last, b.category_ids)
    carry = rollover_carry(s, b, month)
    limit = b.limit + carry
    total = diff_days(last, first) + 1
    elapsed = min(total, max(0, diff_days(t, first) + 1))
    days_left = max(0, total - elapsed)
    left = limit - spent
    return BudgetView(
        budget=b,
        month=month,
        spent=spent,
        limit=limit,
        carry=carry,
        pct=spent / limit if limit else 0.0,
        pace=elapsed / total,
        days_left=days_left,
        safe_per_day=max(0, left) / (days_left + 1) if days_left > 0 else 0.0,
        first=first,
        last=last,
    )


def today_allowance(v: BudgetView, spent_today: int) -> float:
    return max(0, v.limit - v.spent + spent_today) / (v.days_left + 1)


def avg_spend(s: State, ids: list[str] | None, months: int = 3) -> float:
    """Average spend per budget month over the last ``months`` full months
    (months starting more than 95 days ago are skipped)."""
    sd = s.settings.month_start_day
    cur = month_of(s.today, sd)
    total = 0
    n = 0
    for i in range(1, months + 1):
        f, t = month_range(add_months(cur, -i), sd)
        if f < add_days(s.today, -95):
            continue
        total += spend_in(s, f, t, ids)
        n += 1
    return total / n if n else 0.0


# ---------------------------------------------------------------------------
# Planned items
# ---------------------------------------------------------------------------


def _occurs_on(p: Plan, k: date) -> bool:
    sc = p.schedule
    kind = sc["kind"]
    last = last_dom(k.year, k.month)
    if kind == "once":
        return k == parse_day(str(sc["date"]))
    if kind == "monthly":
        return k.day == min(int(sc["day"]), last)
    if kind == "semimonthly":
        return any(k.day == min(int(x), last) for x in sc["days"])
    if kind == "weekly":
        diff = diff_days(k, parse_day(str(sc["anchor"])))
        return diff >= 0 and diff % (7 * int(sc["every"])) == 0
    raise ValueError("unknown schedule kind")


def occurrences(p: Plan, first: date, last: date) -> list[date]:
    """Scheduled days of ``p`` inside ``[first, last]``, honouring the end
    rule (``never``, ``date`` inclusive, ``count`` = the first N occurrences
    counted from ``start``)."""
    sc = p.schedule
    if sc["kind"] == "once":
        d = parse_day(str(sc["date"]))
        return [d] if first <= d <= last else []
    end = p.end_rule
    end_date = parse_day(str(end["date"])) if end["kind"] == "date" else date.max
    stop = min(last, end_date)
    out: list[date] = []
    n = 0
    k = p.start
    while k <= stop:
        if _occurs_on(p, k):
            n += 1
            if end["kind"] == "count" and n > int(end["n"]):
                break
            if k >= first:
                out.append(k)
        k = add_days(k, 1)
    return out


@dataclass
class Occurrence:
    item: Plan
    day: date
    orig: date
    status: OccStatus
    record_id: str | None = None


def paid_index(s: State) -> dict[tuple[str, date], str]:
    idx: dict[tuple[str, date], str] = {}
    for r in s.records:
        if r.planned_id and r.planned_on:
            idx[(r.planned_id, r.planned_on)] = r.id
    return idx


def occurrences_in(
    s: State, first: date, last: date, *, include_what_if: bool = False
) -> list[Occurrence]:
    t = s.today
    paid = paid_index(s)
    out: list[Occurrence] = []
    for p in s.planned:
        if p.archived or (p.is_what_if and not include_what_if):
            continue
        # A snoozed occurrence can land up to two weeks after its own day.
        for orig in occurrences(p, add_days(first, -14), last):
            day = p.snoozed.get(orig, orig)
            if day < first or day > last:
                continue
            record_id = paid.get((p.id, orig))
            status: OccStatus
            if record_id:
                status = "paid"
            elif orig in p.skipped:
                status = "skipped"
            elif day < t:
                status = "overdue"
            elif day <= add_days(t, 1):
                status = "due"
            else:
                status = "upcoming"
            out.append(Occurrence(p, day, orig, status, record_id))
    out.sort(key=lambda o: o.day)
    return out


def due_now(s: State) -> list[Occurrence]:
    t = s.today
    return [
        o
        for o in occurrences_in(s, add_days(t, -14), add_days(t, 1))
        if o.status in ("overdue", "due")
    ]


def monthly_eq(p: Plan) -> float:
    kind = p.schedule["kind"]
    if kind == "once":
        return 0
    if kind == "monthly":
        return p.amount
    if kind == "semimonthly":
        return p.amount * 2
    return p.amount * 52 / 12 / int(p.schedule["every"])


# ---------------------------------------------------------------------------
# Projection
# ---------------------------------------------------------------------------


@dataclass
class WhatIf:
    amount: int
    month: str
    installments: int = 1


@dataclass
class ProjMonth:
    key: str
    inflow: int
    planned: int
    unplanned: float
    what_if: float
    net: float
    end: float
    end_base: float


@dataclass
class Low:
    value: float
    key: str


@dataclass
class Projection:
    start: int
    months: list[ProjMonth]
    avg_unplanned: float
    low: Low
    low_base: Low
    avg_surplus: float
    has_income: bool
    recovery_months: int | None


def avg_unplanned(s: State) -> float:
    """Three-month average of unplanned spend (expenses with no planned item,
    minus refunds) over the last three calendar months."""
    cur = month_of(s.today, 1)
    total = 0
    for i in range(1, 4):
        f, to = month_range(add_months(cur, -i), 1)
        for r in s.records:
            if not is_flow(r) or r.planned_id:
                continue
            if r.day < f or r.day > to:
                continue
            if r.type == "expense":
                total += r.amount
            elif r.is_refund:
                total -= r.amount
    return total / 3


def project(
    s: State,
    *,
    horizon: int,
    include_unplanned: bool,
    excluded_planned: Iterable[str] = (),
    excluded_accounts: Iterable[str] = (),
    what_if: WhatIf | None = None,
    extra_planned: Iterable[Plan] = (),
) -> Projection:
    """Projected liquid balance per calendar month over ``horizon`` months."""
    t = s.today
    bal = balances(s)
    excl = set(excluded_accounts)
    liquid_ids = [
        a.id
        for a in s.accounts
        if a.in_projection and not a.archived and a.id not in excl
    ]
    liquid_set = set(liquid_ids)
    start = sum(bal[i] for i in dict.fromkeys(liquid_ids))
    avg_u = avg_unplanned(s)
    cur = month_of(t, 1)
    ex_planned = set(excluded_planned)
    items = [
        p
        for p in s.planned
        if not p.archived
        and not p.is_what_if
        and p.in_projection
        and p.id not in ex_planned
    ] + list(extra_planned)
    paid = paid_index(s)
    end: float = start
    end_base: float = start
    months: list[ProjMonth] = []
    has_income = False
    for i in range(horizon):
        mk = add_months(cur, i)
        mf, mt = month_range(mk, 1)
        first = add_days(t, 1) if i == 0 else mf
        inflow = 0
        planned_out = 0
        for p in items:
            for o in occurrences(p, first, mt):
                if (p.id, o) in paid or o in p.skipped:
                    continue
                if p.type == "income":
                    inflow += p.amount
                    has_income = True
                elif p.type == "expense":
                    planned_out += p.amount
                else:
                    from_liquid = p.account_id in liquid_set
                    to_liquid = bool(p.to_account_id) and p.to_account_id in liquid_set
                    if from_liquid and not to_liquid:
                        planned_out += p.amount
                    if not from_liquid and to_liquid:
                        inflow += p.amount
        share = max(0, diff_days(mt, t)) / (diff_days(mt, mf) + 1) if i == 0 else 1.0
        unplanned = avg_u * share if include_unplanned else 0.0
        wi = 0.0
        if what_if is not None and what_if.amount > 0:
            idx = month_index(what_if.month, cur)
            n = max(1, what_if.installments)
            if idx <= i < idx + n:
                wi = what_if.amount / n
        net_base = inflow - planned_out - unplanned
        end_base += net_base
        end += net_base - wi
        months.append(
            ProjMonth(
                key=mk,
                inflow=inflow,
                planned=planned_out,
                unplanned=unplanned,
                what_if=wi,
                net=net_base - wi,
                end=end,
                end_base=end_base,
            )
        )

    def low_of(sel: Callable[[ProjMonth], float]) -> Low:
        lo = Low(value=start, key=cur)
        for m in months:
            if sel(m) < lo.value:
                lo = Low(value=sel(m), key=m.key)
        return lo

    recovery: int | None = None
    if what_if is not None and what_if.amount > 0:
        idx = month_index(what_if.month, cur)
        before: float | None
        if idx > 0:
            before = months[idx - 1].end if idx - 1 < len(months) else None
        else:
            before = start
        if before is not None:
            back = next(
                (j for j, m in enumerate(months) if j >= idx and m.end >= before),
                -1,
            )
            recovery = None if back == -1 else back - idx + 1
    full = months[1:]
    return Projection(
        start=start,
        months=months,
        avg_unplanned=avg_u,
        low=low_of(lambda m: m.end),
        low_base=low_of(lambda m: m.end_base),
        avg_surplus=(sum(m.net + m.what_if for m in full) / len(full) if full else 0.0),
        has_income=has_income,
        recovery_months=recovery,
    )


def runway_months(s: State) -> float:
    """Projected start balance (liquid accounts) divided by the average
    monthly spend of the last three calendar months."""
    p = project(s, horizon=1, include_unplanned=False)
    mk = month_of(s.today, 1)
    spend = 0
    for i in range(1, 4):
        f, t = month_range(add_months(mk, -i), 1)
        spend += flow_in(s, f, t).spend
    return p.start / (spend / 3) if spend else 0.0


# ---------------------------------------------------------------------------
# Statement import
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RawHint:
    pattern: re.Pattern[str]
    payee: str
    cat: str | None
    specificity: int


def _hint(words: str, payee: str, cat: str | None) -> RawHint:
    """``words`` is ``|``-separated keywords, each matched as whole words."""
    alts = "|".join(re.escape(w).replace(r"\ ", r"\s+") for w in words.split("|"))
    return RawHint(re.compile(rf"\b(?:{alts})\b", re.IGNORECASE), payee, cat, max(len(w) for w in words.split("|")))


# Statement-text hints: keyword(s), payee, category slug (mapped to the
# user's ids by the caller).
#
# DIVERGES FROM THE PROTOTYPE on purpose. ``RAW_HINTS`` in the prototype
# matches the bare FIRST WORD of each merchant's statement text anywhere in
# the line, first hit wins, so "FOODPANDA PHILIPPINES" and "SHOPEEPAY
# PHILIPPINES" become 7-Eleven ("PHILIPPINE SEVEN"), "SMART COMMUNICATIONS"
# becomes SM Supermarket, "GRABFOOD" becomes a Grab ride and "WITHHOLDING
# TAX ON INTEREST" becomes interest income. Here every keyword matches as
# whole words and the most specific (longest) keyword wins. Matching and
# reconcile states are unaffected; only the guessed payee and category of
# those lines differ (pinned in ``test_calc_golden``).
_HINTS: tuple[RawHint, ...] = (
    _hint("JOLLIBEE", "Jollibee", "dining"),
    _hint("MANG INASAL", "Mang Inasal", "dining"),
    _hint("CHOWKING", "Chowking", "dining"),
    _hint("PHILIPPINE SEVEN|7-ELEVEN|7 ELEVEN", "7-Eleven", "dining"),
    _hint("STARBUCKS", "Starbucks", "coffee"),
    _hint("TIM HORTONS", "Tim Hortons", "coffee"),
    _hint("GRAB PHILIPPINES|GRAB", "Grab", "grab"),
    _hint("GRABFOOD", "GrabFood", "dining"),
    _hint("SM SUPERMARKET|SM MARKETS", "SM Supermarket", "groceries"),
    _hint("PUREGOLD", "Puregold", "groceries"),
    _hint("SHOPEEPAY|SHOPEE", "Shopee", "shopping"),
    _hint("LAZADA", "Lazada", "shopping"),
    _hint("MERCURY DRUG", "Mercury Drug", "health"),
    _hint("SM CINEMA", "SM Cinema", "entertainment"),
    _hint("ROMANTIC BABOY", "Romantic Baboy", "dining"),
    _hint("MERALCO", "Meralco", "electricity"),
    _hint("SMART", "Smart", "phone"),
    _hint("LUMEN", "Lumen Studio", "freelance"),
    _hint("INTEREST", "BPI", "interest"),
    _hint("WITHHOLDING TAX|TAX", "BPI", "fees"),
    _hint("SEND MONEY", "Send Money", "gifts"),
    _hint("FOODPANDA", "foodpanda", "dining"),
)
RAW_HINTS: tuple[RawHint, ...] = tuple(sorted(_HINTS, key=lambda h: -h.specificity))

_PREFIX = re.compile(
    r"^(Payment to|Bills Payment —|Received money from)\s*", re.IGNORECASE
)
_WORD_START = re.compile(r"\b\w", re.ASCII)


def guess_payee(raw: str) -> tuple[str, str | None]:
    """``(payee, category slug)`` guessed from a statement description."""
    for h in RAW_HINTS:
        if h.pattern.search(raw):
            return h.payee, h.cat
    cleaned = _PREFIX.sub("", raw).lower()
    return _WORD_START.sub(lambda m: m.group(0).upper(), cleaned), None


@dataclass
class StatementRow:
    ref: str
    date: date
    time: str
    raw: str
    amount: int
    direction: Direction
    pending: bool = False


@dataclass
class ImportRowCalc:
    """A statement row after reconciliation (one per input row, same order)."""

    row: StatementRow
    position: int
    payee: str
    suggested_category_id: str | None
    category_id: str | None
    state: str
    confidence: float
    decision: str
    is_transfer: bool
    reason: str | None = None
    match_id: str | None = None

    @property
    def signed(self) -> int:
        return self.row.amount if self.row.direction == "in" else -self.row.amount


_TRANSFER = re.compile(r"cash-in|transfer", re.IGNORECASE)
_SEND_MONEY = re.compile(r"send money", re.IGNORECASE)


def _cat_id(s: State, slug: str | None) -> str | None:
    return s.cat_by_slug.get(slug) if slug else None


def reconcile(
    s: State, account_id: str, rows: list[StatementRow], import_id: str
) -> list[ImportRowCalc]:
    """Match statement rows against the account's records.

    Pending rows are ignored; a row repeated inside the file is a duplicate;
    an exact amount within a day of a record is ``matched`` (or a
    ``duplicate`` when an earlier import already claimed that record); an
    amount within max(₱30, 10%) and three days is ``probable``; the rest are
    ``new``. Each record is claimed at most once.
    """
    recs = [
        r
        for r in s.records
        if r.account_id == account_id or r.to_account_id == account_id
    ]
    claimed: set[str] = set()
    seen: set[tuple[str, date, int, str]] = set()

    def direction(r: Rec) -> str:
        return "in" if signed_for(r, account_id) > 0 else "out"

    out: list[ImportRowCalc] = []
    for i, row in enumerate(rows):
        payee, cat = guess_payee(row.raw)
        is_transfer = bool(_TRANSFER.search(row.raw))
        cid = None if is_transfer else _cat_id(s, cat)
        out.append(
            ImportRowCalc(
                row=row,
                position=i,
                payee="Cash-in" if is_transfer else payee,
                suggested_category_id=cid,
                category_id=cid,
                state="new",
                confidence=0.86,
                decision="accept",
                is_transfer=is_transfer,
            )
        )
    for r in out:
        if r.row.pending:
            r.state, r.decision = "pending", "ignore"
            r.reason = "Pending authorisation — not final yet"
            continue
        sig = (r.row.ref, r.row.date, r.row.amount, r.row.raw)
        if sig in seen:
            r.state, r.decision = "duplicate", "ignore"
            r.reason = "Appears twice in this file"
        seen.add(sig)

    def open_rows() -> list[ImportRowCalc]:
        return [r for r in out if r.state == "new"]

    for r in open_rows():
        cand = next(
            (
                x
                for x in recs
                if x.id not in claimed
                and direction(x) == r.row.direction
                and x.amount == r.row.amount
                and abs(diff_days(x.day, r.row.date)) <= 1
            ),
            None,
        )
        if cand is None:
            continue
        claimed.add(cand.id)
        r.match_id = cand.id
        if cand.import_id and cand.import_id != import_id:
            r.state, r.decision = "duplicate", "ignore"
            r.reason = "Already matched in an earlier import"
        else:
            r.state, r.decision, r.confidence = "matched", "accept", 0.97
    for r in open_rows():
        amt = r.row.amount
        cand = next(
            (
                x
                for x in recs
                if x.id not in claimed
                and direction(x) == r.row.direction
                and abs(x.amount - amt) <= max(3000, amt * 0.1)
                and abs(diff_days(x.day, r.row.date)) <= 3
                and (x.amount != amt or x.day != r.row.date)
            ),
            None,
        )
        if cand is None:
            continue
        claimed.add(cand.id)
        r.state, r.decision, r.match_id = "probable", "take", cand.id
        r.confidence = 0.74 if cand.amount == amt else 0.62
        r.reason = (
            "Amount differs from your transaction"
            if cand.amount != amt
            else "Date differs from your transaction"
        )
    for r in open_rows():
        if _SEND_MONEY.search(r.row.raw):
            r.confidence = 0.48
            r.reason = "Unclear purpose — pick a category"
            r.category_id = None
    return out


def needs_attention(state: str, confidence: float) -> bool:
    return state in ("probable", "duplicate", "pending") or (
        state == "new" and confidence < 0.7
    )


def statement_closing(
    s: State, account_id: str, to: date, rows: list[ImportRowCalc]
) -> int:
    """The balance the statement implies at ``to``: the app balance plus the
    rows the import would add or correct."""
    acct = next((a for a in s.accounts if a.id == account_id), None)
    if acct is None:
        return 0
    b = balance_of(s, acct, to)
    recs = {r.id: r for r in s.records}
    for r in rows:
        if r.state == "new":
            b += r.signed
        if r.state == "probable" and r.match_id:
            x = recs.get(r.match_id)
            if x is not None:
                b += r.signed - signed_for(x, account_id)
    return b


def suggest_category(s: State, payee: str) -> str | None:
    """The category last used with a payee starting with this text, else the
    statement-hint guess."""
    p = payee.strip().lower()
    if not p:
        return None
    for r in reversed(s.records):
        if r.payee and r.payee.lower().startswith(p) and r.category_id:
            return r.category_id
    return _cat_id(s, guess_payee(payee)[1])


def recent_categories(s: State, last_category_id: str | None, n: int = 8) -> list[str]:
    since = add_days(s.today, -30)
    count: dict[str, int] = {}
    for r in s.records:
        if r.type != "expense" or not r.category_id or r.is_adjustment:
            continue
        if r.day < since:
            continue
        count[r.category_id] = count.get(r.category_id, 0) + 1
    ranked = [k for k, _ in sorted(count.items(), key=lambda kv: -kv[1])]
    ordered = (
        [last_category_id, *[x for x in ranked if x != last_category_id]]
        if last_category_id
        else ranked
    )
    return ordered[:n]


# ---------------------------------------------------------------------------
# Reports and look-backs
# ---------------------------------------------------------------------------


@dataclass
class PeriodRange:
    first: date
    last: date
    prev_first: date
    prev_last: date
    month: str | None


def period_range(s: State, p: Period) -> PeriodRange:
    sd = s.settings.month_start_day
    t = s.today
    mk = month_of(t, sd)
    if p == "3m":
        first = month_range(add_months(mk, -2), sd)[0]
        length = diff_days(t, first) + 1
        return PeriodRange(
            first, t, add_days(first, -length), add_days(first, -1), None
        )
    m = mk if p == "this" else add_months(mk, -1)
    first, last = month_range(m, sd)
    pf, pt = month_range(add_months(m, -1), sd)
    return PeriodRange(first, min(last, t), pf, pt, m)


@dataclass
class Report:
    range: PeriodRange
    flow: Flow
    prev: Flow
    by_cat: list[tuple[str, int]]
    payees: list[tuple[str, int]]
    daily: list[int]
    days: int
    weekday_avg: list[float]
    months: list[tuple[str, int, int]]
    budgets: list[tuple[Bud, list[BudgetView]]]
    net_worth: list[int]


def report_data(s: State, p: Period) -> Report:
    r = period_range(s, p)
    flow = flow_in(s, r.first, r.last)
    prev = flow_in(s, r.prev_first, r.prev_last)
    by_cat = sorted(
        ((k, v) for k, v in flow.by_cat.items() if v > 0), key=lambda kv: -kv[1]
    )
    payees = sorted(flow.by_payee.items(), key=lambda kv: -kv[1])[:8]
    days = diff_days(r.last, r.first) + 1
    by_day: dict[date, int] = {}
    weekday = [0] * 7
    weekday_n = [0] * 7
    for x in s.records:
        if not is_flow(x) or x.day < r.first or x.day > r.last:
            continue
        if x.type == "income" and not x.is_refund:
            v = x.amount
        elif x.type == "expense":
            v = -x.amount
        else:
            v = x.amount
        by_day[x.day] = by_day.get(x.day, 0) + v
        if x.type == "expense":
            weekday[js_weekday(x.day)] += x.amount
    cum = 0
    daily: list[int] = []
    for i in range(days):
        k = add_days(r.first, i)
        weekday_n[js_weekday(k)] += 1
        cum += by_day.get(k, 0)
        daily.append(cum)
    sd = s.settings.month_start_day
    mk = month_of(s.today, sd)
    months = []
    for i in (-3, -2, -1, 0):
        f, t = month_range(add_months(mk, i), sd)
        fl = flow_in(s, f, t)
        months.append((add_months(mk, i), fl.income, fl.spend))
    budgets = [
        (b, [budget_view(s, b, add_months(mk, i)) for i in (-2, -1, 0)])
        for b in s.budgets
        if not b.archived
    ]
    return Report(
        range=r,
        flow=flow,
        prev=prev,
        by_cat=by_cat,
        payees=payees,
        daily=daily,
        days=days,
        weekday_avg=[
            v / weekday_n[i] if weekday_n[i] else 0.0 for i, v in enumerate(weekday)
        ],
        months=months,
        budgets=budgets,
        net_worth=net_worth_series(s, 90),
    )


@dataclass
class Leak:
    payee: str
    n: int
    v: int
    cat: str | None


@dataclass
class LookbackData:
    flow: Flow
    prev: Flow
    base: float
    rate: float
    prev_rate: float
    no_spend: NoSpend
    budgets: list[BudgetView]
    kept: list[BudgetView]
    blown: list[BudgetView]
    where: list[tuple[str, int, int]]
    spikes: list[tuple[str, int, int]]
    big: list[Rec]
    leaks: list[Leak]
    subs: int
    completeness: float
    top_share: float
    length: int


def lookback(
    s: State, first: date, last: date, prev_first: date, prev_last: date
) -> LookbackData:
    flow = flow_in(s, first, last)
    prev = flow_in(s, prev_first, prev_last)
    length = diff_days(last, first) + 1
    base = 0
    for i in range(1, 4):
        base += flow_in(
            s, add_days(first, -length * i), add_days(first, -length * (i - 1) - 1)
        ).spend
    base_avg = base / 3
    sd = s.settings.month_start_day
    mk = month_of(first, sd)
    is_month = month_range(mk, sd)[0] == first
    views = (
        [budget_view(s, b, mk) for b in s.budgets if not b.archived] if is_month else []
    )
    cats = cat_map(s)
    where = [
        (k, v, prev.by_cat.get(k, 0))
        for k, v in sorted(
            ((k, v) for k, v in flow.by_cat.items() if v > 0), key=lambda kv: -kv[1]
        )
    ]
    # Spikes: a category up more than 25% on a previous period above ₱500.
    spikes = [w for w in where if w[2] > 50000 and w[1] > w[2] * 1.25]
    in_range = [r for r in s.records if first <= r.day <= last]
    big = [
        r
        for r in in_range
        if r.type == "expense" and not r.planned_id and r.amount >= 500000
    ]
    by_payee: dict[str, Leak] = {}
    for r in in_range:
        if r.type != "expense" or not r.payee or r.amount > 100000:
            continue
        c = cats.get(r.category_id or "")
        if c is None or not c.discretionary:
            continue
        cur = by_payee.get(r.payee) or Leak(r.payee, 0, 0, r.category_id)
        by_payee[r.payee] = Leak(r.payee, cur.n + 1, cur.v + r.amount, cur.cat)
    leaks = sorted((x for x in by_payee.values() if x.n >= 4), key=lambda x: -x.v)[:4]
    subs_id = s.cat_by_slug.get("subs")
    subs = sum(r.amount for r in in_range if subs_id and r.category_id == subs_id)
    imported = sum(1 for r in in_range if r.source == "import")
    completeness = 1 - imported / len(in_range) if in_range else 1.0
    top_share = where[0][1] / max(100, flow.spend) if where else 0.0
    return LookbackData(
        flow=flow,
        prev=prev,
        base=base_avg,
        rate=savings_rate(flow),
        prev_rate=savings_rate(prev),
        no_spend=no_spend_days(s, first, last),
        budgets=views,
        kept=[v for v in views if v.pct <= 1],
        blown=[v for v in views if v.pct > 1],
        where=where,
        spikes=spikes,
        big=big,
        leaks=leaks,
        subs=subs,
        completeness=completeness,
        top_share=top_share,
        length=length,
    )


# ---------------------------------------------------------------------------
# Stats helpers (prototype ``finance/index.ts``)
# ---------------------------------------------------------------------------


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def budget_score(s: State) -> float:
    views = [budget_view(s, b) for b in s.budgets if not b.archived]
    if not views:
        return 0.5
    ok = [v for v in views if v.pct <= max(v.pace + 0.1, 0.1) and v.pct <= 1]
    return len(ok) / len(views)


def area_rate(s: State, days: int, offset: int = 0) -> float | None:
    """``0.6·clamp(savingsRate/0.3) + 0.4·budgetScore`` over at least 30
    days, rounded to two places. ``None`` with no accounts (nothing to rate)."""
    if not s.accounts:
        return None
    to = add_days(s.today, -offset)
    sr = savings_rate(flow_in(s, add_days(to, -(max(days, 30) - 1)), to))
    return js_round((0.6 * clamp01(sr / 0.3) + 0.4 * budget_score(s)) * 100) / 100
