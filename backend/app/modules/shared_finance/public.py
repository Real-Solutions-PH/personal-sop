"""Cross-module contract of shared money (read by Fern's ``finance_status``).
Nothing here writes."""

from typing import Any

from app.modules.shared_finance import services
from app.shared.context import Ctx
from app.shared.currency import currency, money


def loans_status(ctx: Ctx) -> list[dict[str, Any]]:
    """Every open or invited loan, from the caller's side: who, which way,
    the total, what is paid, what is left, what is waiting for the lender to
    confirm, the next payment and what is overdue. Amounts are written in
    the loan's currency so Fern quotes the numbers the app shows."""
    out: list[dict[str, Any]] = []
    for v in services.list_loans(ctx).data:
        if v.status not in ("invited", "active"):
            continue
        cur = currency(v.currency)
        lender = v.role == "lender"
        other = v.borrower if lender else v.lender
        out.append(
            {
                "person": other.name,
                "direction": "they_owe_me" if lender else "i_owe_them",
                "status": "waiting_for_them_to_accept"
                if v.status == "invited" and lender
                else "waiting_for_me_to_accept"
                if v.status == "invited"
                else "open",
                "purpose": v.purpose,
                "total": money(v.total_minor, cur),
                "paid": money(v.paid_minor, cur),
                "still_owed": money(v.remaining_minor, cur),
                "sent_awaiting_confirmation": money(v.pending_minor, cur),
                "overdue": money(v.overdue_minor, cur) if v.overdue_minor else None,
                "next_payment": {
                    "due": v.next_due.due.isoformat(),
                    "amount": money(
                        v.next_due.amount_minor - v.next_due.paid_minor, cur
                    ),
                }
                if v.next_due
                else None,
                "payments_made": sum(1 for p in v.payments if p.status == "accepted"),
                "payments_total": len(v.installments),
            }
        )
    return out
