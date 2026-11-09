"""The free Fern allowance and the Plus fair-use limit (pricing ruling
2026-11-08, ADR-0038).

A Fern turn is one message the person sent, answered on the server's key.
Each is written once to ``fern_turn``, keyed by the question's id, so a
resent or retried message never counts twice and a turn whose transaction
rolled back (nothing stored) never counts at all. Turns are counted within
the person's business day (their time zone and day-start hour), the same
way :func:`ai_providers.public.month_window` bounds a month.

- Free: ``FERN_FREE_DAILY_WEEK_ONE`` a day for the account's first
  ``FERN_FREE_WEEK_ONE_DAYS`` business days, then ``FERN_FREE_DAILY``; in a
  low-price country (price tier ``FERN_LOW_PRICE_TIER`` and up) the
  ``*_LOW_PRICE`` pair. Past it: 402 ``fern_daily_allowance_reached``.
- Plus: a monthly AI budget by price tier (``FERN_PLUS_BUDGET_USD_TIER_n``,
  server-key spend of every purpose in the business month); past it Fern
  answers on the light model (``FERN_LIGHT_MODELS``). Hard stops:
  ``FERN_PLUS_DAILY_HARD_STOP`` turns a day (402
  ``fern_daily_allowance_reached``) and ``FERN_PLUS_MONTHLY_HARD_STOP_USD``
  of spend a month (402 ``fern_monthly_limit_reached``).

Both errors carry ``resets_at``, the instant the limit lifts. The person's own
monthly spend cap (``ai_settings.spend_cap_minor``, :func:`check_budget`)
still applies on top of all of this.
"""

import uuid
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import col, func, select

from app.core.config import settings
from app.modules.ai_providers import price_tier
from app.modules.ai_providers.models import AIUsage, FernTurn
from app.modules.billing.public import plan_of as billing_plan
from app.shared.context import Ctx
from app.shared.domain import domain_error

if TYPE_CHECKING:
    from app.modules.ai_providers.public import ResolvedModel

Plan = Literal["free", "plus"]


def plan_of(ctx: Ctx) -> Plan:
    """The account's plan: the ONE place the allowance learns it.

    Read from the ``entitlement`` table, which only verified RevenueCat
    webhooks and the server's own refresh write (ADR-0037). Plus counts
    while its end is still ahead of ``ctx.now``; anything else is free.
    """
    return (
        "plus" if billing_plan(ctx.session, ctx.user_id, ctx.now) == "plus" else "free"
    )


def day_window(ctx: Ctx, day: date) -> tuple[datetime, datetime]:
    """The user's business day ``day`` as a half-open UTC interval."""
    return ctx.clock.start_of(day), ctx.clock.start_of(day + timedelta(days=1))


def _month_window(ctx: Ctx, day: date) -> tuple[datetime, datetime]:
    from app.modules.ai_providers.public import month_window

    return month_window(ctx, day)


def usd_minor(usd: float) -> int:
    """A US-dollar limit in the centavos ``ai_usage.cost_minor`` holds."""
    return round(max(0.0, usd) * settings.AI_USD_TO_PHP * 100)


def tier_of(ctx: Ctx) -> int:
    """The account's price tier: the App Store storefront's country, else
    the country of the account's time zone (``price_tier``)."""
    from app.modules.profile.models import UserProfile

    storefront = ctx.session.exec(
        select(UserProfile.storefront_country).where(
            UserProfile.owner_id == ctx.user_id
        )
    ).first()
    return price_tier.tier_of(price_tier.country_of(storefront, ctx.clock.timezone))


def _plus_budget_usd(tier: int) -> float:
    if tier >= 3:
        return settings.FERN_PLUS_BUDGET_USD_TIER_3
    if tier == 2:
        return settings.FERN_PLUS_BUDGET_USD_TIER_2
    return settings.FERN_PLUS_BUDGET_USD_TIER_1


def _free_limit(ctx: Ctx, tier: int) -> int:
    joined = ctx.user.created_at or ctx.now
    day_number = (ctx.today - ctx.clock.day_of(joined)).days
    week_one = day_number < settings.FERN_FREE_WEEK_ONE_DAYS
    if tier >= settings.FERN_LOW_PRICE_TIER:
        return (
            settings.FERN_FREE_DAILY_WEEK_ONE_LOW_PRICE
            if week_one
            else settings.FERN_FREE_DAILY_LOW_PRICE
        )
    return settings.FERN_FREE_DAILY_WEEK_ONE if week_one else settings.FERN_FREE_DAILY


@dataclass(frozen=True)
class Allowance:
    plan: Plan
    tier: int
    # Messages a day: the free allowance, or Plus's hard stop.
    limit: int
    used: int
    # When today's count starts again (the next business day's start).
    resets_at: datetime
    # Plus past its monthly budget: Fern answers on the light model.
    light: bool = False
    # Plus at its monthly hard stop, and when that lifts.
    month_stopped: bool = False
    month_resets_at: datetime | None = None

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def allowance(ctx: Ctx) -> Allowance:
    """Where this account stands today. Reads only."""
    plan = plan_of(ctx)
    tier = tier_of(ctx)
    start, end = day_window(ctx, ctx.today)
    used = ctx.session.exec(
        select(func.count()).where(
            FernTurn.owner_id == ctx.user_id,
            FernTurn.tenant_id == ctx.tenant_id,
            col(FernTurn.at) >= start,
            col(FernTurn.at) < end,
        )
    ).one()
    if plan == "free":
        return Allowance(
            plan=plan,
            tier=tier,
            limit=_free_limit(ctx, tier),
            used=int(used),
            resets_at=end,
        )
    m_start, m_end = _month_window(ctx, ctx.today)
    spend = ctx.session.exec(
        select(func.coalesce(func.sum(AIUsage.cost_minor), 0)).where(
            AIUsage.owner_id == ctx.user_id,
            AIUsage.tenant_id == ctx.tenant_id,
            col(AIUsage.deleted_at).is_(None),
            # The server's key; a person's own key is theirs to pay.
            col(AIUsage.credential_id).is_(None),
            col(AIUsage.at) >= m_start,
            col(AIUsage.at) < m_end,
        )
    ).one()
    spend = int(spend)
    return Allowance(
        plan=plan,
        tier=tier,
        limit=settings.FERN_PLUS_DAILY_HARD_STOP,
        used=int(used),
        resets_at=end,
        light=spend >= usd_minor(_plus_budget_usd(tier)),
        month_stopped=spend >= usd_minor(settings.FERN_PLUS_MONTHLY_HARD_STOP_USD),
        month_resets_at=m_end,
    )


def check_fern_turn(ctx: Ctx) -> Allowance:
    """Refuse a new Fern message the account's allowance does not cover.

    402 ``fern_daily_allowance_reached`` (today's messages are used up) or
    ``fern_monthly_limit_reached`` (Plus's monthly hard stop); both carry
    ``resets_at``. Reads only."""
    a = allowance(ctx)
    if not settings.FERN_ALLOWANCE_ENFORCED:
        return a
    if a.month_stopped and a.month_resets_at is not None:
        raise domain_error(
            402,
            "fern_monthly_limit_reached",
            "Fern has reached this month's fair-use limit.",
            {"resets_at": a.month_resets_at.isoformat(), "plan": a.plan},
        )
    if a.used >= a.limit:
        raise domain_error(
            402,
            "fern_daily_allowance_reached",
            "That's all of today's messages with Fern.",
            {
                "resets_at": a.resets_at.isoformat(),
                "limit": a.limit,
                "plan": a.plan,
            },
        )
    return a


def count_fern_turn(ctx: Ctx, message_id: uuid.UUID, a: Allowance) -> None:
    """Count the message ``message_id`` once; a second call for the same id
    (a resend, a retry) changes nothing. Flushes only."""
    ctx.session.execute(
        insert(FernTurn)
        .values(
            id=uuid.uuid4(),
            **ctx.owned(),
            created_at=ctx.now,
            updated_at=ctx.now,
            at=ctx.now,
            message_id=message_id,
            plan=a.plan,
            light=a.light,
        )
        .on_conflict_do_nothing(constraint="uq_fern_turn_message")
    )


def light_model(resolved: "ResolvedModel") -> "ResolvedModel":
    """``resolved`` on the lighter model named for its purpose; unchanged
    when no light model is named for it."""
    name = settings.fern_light_models.get(resolved.purpose)
    return replace(resolved, model=name) if name else resolved
