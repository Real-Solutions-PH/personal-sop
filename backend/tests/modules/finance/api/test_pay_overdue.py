"""A bill paid through Fern leaves the overdue list ("Even after paying this
recurring expense, it keeps on coming back"). A monthly "Gym membership"
whose account is archived ("No account") is three days late; "paid my gym
membership 1000" logged through ``public.log_expense`` (Fern's chat and
capture path) settles that date, the next one is a month on, and a later
Pay on the bill from another device is the same record, never a second."""

from datetime import datetime, time, timedelta

from sqlmodel import Session

from app.modules.finance import calc, public, repo, services
from app.modules.finance.schema import AccountCreate, PlannedCreate
from app.shared.day import DayClock
from tests.utils.day import run_day
from tests.utils.mobile import ctx_for, signed_in

TODAY = run_day()
DUE = TODAY - timedelta(days=3)


def _at(hh: int) -> datetime:
    return datetime.combine(TODAY, time(hh), tzinfo=DayClock().zone)


def _overdue(s: calc.State) -> list[tuple[str, str]]:
    return [(o.item.name, o.orig.isoformat()) for o in calc.due_now(s)]


def test_fern_logging_the_payment_settles_the_overdue_bill(db: Session) -> None:
    user, _ = signed_in(db)
    with ctx_for(user) as ctx:
        cash = services.add_account(ctx, data=AccountCreate(name="Cash", type="cash"))
        closed = services.add_account(ctx, data=AccountCreate(name="Old", type="bank"))
        health = {c.slug: c.id for c in public.list_categories(ctx) if c.slug}["health"]
        gym = services.add_planned(
            ctx,
            data=PlannedCreate(
                name="Gym membership",
                type="expense",
                amount_minor=100_000,
                account_id=closed.id,
                category_id=health,
                schedule={"kind": "monthly", "day": DUE.day},
                start=DUE - timedelta(days=62),
            ),
        )
        services.update_account(
            ctx,
            account_id=closed.id,
            data=AccountCreate(name="Old", type="bank", archived=True),
        )
        ids = (cash.id, gym.id)
        assert _overdue(repo.load_state(ctx, repo.settings_row(ctx))) == [
            ("Gym membership", DUE.isoformat())
        ]
    cash_id, gym_id = ids
    with ctx_for(user) as ctx:
        # Something else first: a coffee pays nothing.
        coffee = public.log_expense(
            ctx, amount_minor=15_000, payee="Coffee", account_id=cash_id, at=_at(9)
        )
        assert coffee.planned_id is None
        rec = public.log_expense(
            ctx, amount_minor=100_000, payee="gym membership", at=_at(10)
        )
        assert (rec.planned_id, rec.planned_on) == (gym_id, DUE)
        ctx.commit()
        rid = rec.id
    with ctx_for(user) as ctx:
        s = repo.load_state(ctx, repo.settings_row(ctx))
        assert _overdue(s) == []
        # The next unpaid date is next month's.
        unpaid = [
            o.orig
            for o in calc.occurrences_in(s, DUE, TODAY + timedelta(days=40))
            if o.item.id == str(gym_id) and o.status != "paid"
        ]
        assert unpaid and unpaid[0] > TODAY and unpaid[0].month != DUE.month
        # The same payment logged twice in a turn: the second pays nothing.
        again = public.log_expense(
            ctx, amount_minor=100_000, payee="Gym membership", at=_at(11)
        )
        assert again.planned_id is None
        # A replay of the first (a capture redone) keeps its date.
        replay = public.log_expense(
            ctx,
            amount_minor=100_000,
            payee="gym membership",
            at=_at(10),
            record_id=rid,
        )
        assert (replay.id, replay.planned_on) == (rid, DUE)
        # Pay on the bill from a device that had not synced yet: the same
        # record, not a second one for the date.
        settled = services.settle_occurrence(
            ctx, planned_id=gym_id, day=DUE, account_id=cash_id
        )
        assert settled.id == rid
