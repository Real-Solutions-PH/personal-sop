"""Fern's ``finance_status``: where the money stands right now, computed.

"How much do I have", "how's my food budget", "what bills are coming" had
no read: ``lookup`` knows a few fixed questions and ``query_records`` sums
past records but knows nothing of balances, budgets or bills. This reads
the finance module's whole state once and answers all three from its own
calculations (``finance.calc``, the same ones the Money tab draws), so the
numbers Fern says are the numbers the person sees.
"""

from datetime import timedelta
from typing import Any

from app.modules.finance import calc
from app.modules.finance import public as finance
from app.shared.context import Ctx
from app.shared.currency import money

BILLS_AHEAD_DAYS = 7
BILLS_BACK_DAYS = 14


def status(ctx: Ctx) -> dict[str, Any]:
    s = finance.load_state(ctx)
    cur = ctx.currency
    bal = calc.balances(s)
    accounts = [
        {"name": a.name, "type": a.type, "balance": money(bal.get(a.id, 0), cur)}
        for a in s.accounts
        if not a.archived
    ]
    sd = s.settings.month_start_day
    month = calc.month_of(s.today, sd)
    first, last = calc.month_range(month, sd)
    budgets = []
    for b in s.budgets:
        if b.archived:
            continue
        v = calc.budget_view(s, b)
        budgets.append(
            {
                "name": b.name,
                "limit": money(v.limit, cur),
                "spent": money(v.spent, cur),
                "left": money(v.limit - v.spent, cur),
                "used_pct": round(v.pct * 100),
                # How far through the month we are: used_pct above it is
                # spending ahead of pace.
                "month_elapsed_pct": round(v.pace * 100),
                "days_left": v.days_left,
                "safe_per_day": money(round(v.safe_per_day), cur),
                "over": v.spent > v.limit,
            }
        )
    bills = [
        {
            "name": o.item.name,
            "day": o.day.isoformat(),
            "amount": money(o.item.amount, cur),
            "type": o.item.type,
            "status": o.status,
        }
        for o in calc.occurrences_in(
            s,
            s.today - timedelta(days=BILLS_BACK_DAYS),
            s.today + timedelta(days=BILLS_AHEAD_DAYS),
        )
        if o.status in ("overdue", "due", "upcoming")
    ]
    return {
        "today": s.today.isoformat(),
        "accounts": accounts,
        "net_worth": money(calc.net_worth(s, bal), cur),
        "month": {"first_day": first.isoformat(), "last_day": last.isoformat()},
        "spent_this_month_so_far": money(
            calc.spend_in(s, first, min(last, s.today), None), cur
        ),
        "budgets": budgets,
        "bills_overdue_or_due_next_7_days": bills,
        "no_accounts_yet": not accounts,
    }
