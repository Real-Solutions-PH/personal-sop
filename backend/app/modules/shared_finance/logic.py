"""Pure loan arithmetic (no I/O). Mirrored on the phone by
``shared/prototype/finance/loans.ts``; amounts are integer centavos.

- :func:`monthly_installments` splits a total into ``count`` monthly
  installments: equal shares, the leftover centavos on the earliest ones, so
  the sum is exactly the total.
- :func:`summary` lays the accepted payments over the installments in due
  order (oldest first): an installment is paid once the accepted total
  reaches its running total, whatever amounts the payments had.
"""

import calendar
from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class Installment:
    n: int
    due: date
    amount_minor: int


def add_months(day: date, months: int, dom: int) -> date:
    """``day``'s month moved by ``months``, on day ``dom`` (clamped to the
    month's last day: the 31st in February is the 28th or 29th)."""
    m = day.month - 1 + months
    y = day.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(dom, calendar.monthrange(y, m)[1]))


def monthly_installments(
    total_minor: int, count: int, start: date, dom: int
) -> list[Installment]:
    """``count`` monthly installments of ``total_minor``, the first in
    ``start``'s month (or the next one when ``dom`` is already past)."""
    if count < 1:
        raise ValueError("count must be at least 1")
    if total_minor < count:
        raise ValueError("each installment must be at least one centavo")
    first = add_months(start, 0, dom)
    offset = 1 if first < start else 0
    share, extra = divmod(total_minor, count)
    return [
        Installment(
            n=i + 1,
            due=add_months(start, i + offset, dom),
            amount_minor=share + (1 if i < extra else 0),
        )
        for i in range(count)
    ]


@dataclass(frozen=True)
class InstallmentState:
    n: int
    due: date
    amount_minor: int
    paid_minor: int
    # paid | partial | overdue | due | upcoming
    state: str


@dataclass(frozen=True)
class Summary:
    total_minor: int
    paid_minor: int
    pending_minor: int
    remaining_minor: int
    installments: list[InstallmentState]
    next_due: InstallmentState | None
    overdue_minor: int


def summary(
    total_minor: int,
    installments: list[Installment],
    accepted_minor: int,
    pending_minor: int,
    today: date,
) -> Summary:
    left = accepted_minor
    states: list[InstallmentState] = []
    for ins in sorted(installments, key=lambda i: (i.due, i.n)):
        paid = max(0, min(ins.amount_minor, left))
        left -= paid
        if paid >= ins.amount_minor:
            state = "paid"
        elif ins.due < today:
            state = "overdue"
        elif ins.due == today:
            state = "due"
        elif paid > 0:
            state = "partial"
        else:
            state = "upcoming"
        states.append(
            InstallmentState(
                n=ins.n,
                due=ins.due,
                amount_minor=ins.amount_minor,
                paid_minor=paid,
                state=state,
            )
        )
    nxt = next((s for s in states if s.state != "paid"), None)
    overdue = sum(s.amount_minor - s.paid_minor for s in states if s.state == "overdue")
    return Summary(
        total_minor=total_minor,
        paid_minor=accepted_minor,
        pending_minor=pending_minor,
        remaining_minor=max(0, total_minor - accepted_minor),
        installments=states,
        next_due=nxt,
        overdue_minor=overdue,
    )
