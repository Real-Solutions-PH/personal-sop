"""Finance's stats contributor (prototype ``finance/index.ts`` ModuleContract)."""

from datetime import date, timedelta

from app.modules.finance import calc, repo
from app.modules.stats.contract import (
    Achievement,
    CalendarItem,
    DayProgress,
    Facet,
    Metric,
    Miss,
    Window,
)
from app.shared.context import Ctx

r2 = calc.js_round
BIG_PURCHASE_MINOR = 500_000  # ₱5,000


def _state(ctx: Ctx) -> calc.State:
    return repo.load_state(ctx)


def _peso(minor: int) -> str:
    return f"₱{minor // 100:,}"


class FinanceContributor:
    key = "finance"
    label = "Finance"
    href = "/finance"

    def area_rate(self, ctx: Ctx, window: Window) -> float | None:
        """``0.6·clamp(savingsRate/0.3) + 0.4·budgetScore`` over the window
        (at least 30 days) ending on its last day."""
        s = _state(ctx)
        return calc.area_rate(s, window.days, (s.today - window.last).days)

    def day_progress(self, ctx: Ctx, days: list[date]) -> dict[date, DayProgress]:
        """Bills and paydays to settle by hand (auto-logged items excluded):
        due = the day's occurrences plus anything still overdue on it."""
        if not days:
            return {}
        s = _state(ctx)
        occ = calc.occurrences_in(s, min(days) - timedelta(days=14), max(days))
        out: dict[date, DayProgress] = {}
        for d in days:
            due = [
                o
                for o in occ
                if not o.item.auto_log
                and (o.day == d or (o.day < d and o.status == "overdue"))
            ]
            out[d] = DayProgress(
                due=len(due), done=sum(1 for o in due if o.status == "paid")
            )
        return out

    def metrics(self, ctx: Ctx, window: Window, prev: Window) -> list[Metric]:
        s = _state(ctx)
        if not s.accounts:
            return []
        cur = calc.flow_in(s, window.first, window.last)
        pre = calc.flow_in(s, prev.first, prev.last)
        sr, psr = calc.savings_rate(cur), calc.savings_rate(pre)
        ns = calc.no_spend_days(s, window.first, window.last)
        pns = calc.no_spend_days(s, prev.first, prev.last)
        views = [calc.budget_view(s, b) for b in s.budgets if not b.archived]
        kept = sum(1 for v in views if v.pct <= 1)
        runway = calc.runway_months(s)
        spend_vs = cur.spend / pre.spend - 1 if pre.spend else 0.0
        streak = f" · {ns.streak}-day streak" if ns.streak >= 2 else ""
        return [
            Metric(
                key="savings-rate",
                label="Savings rate",
                value=f"{r2(sr * 100)}%",
                number=sr,
                delta=r2((sr - psr) * 100),
                good_when="up",
            ),
            Metric(
                key="no-spend",
                label="No-spend days",
                value=f"{ns.count}{streak}",
                number=ns.count,
                delta=ns.count - pns.count,
                good_when="up",
            ),
            Metric(
                key="budgets",
                label="Budgets on track",
                value=f"{kept}/{len(views)}",
                number=kept / len(views) if views else None,
            ),
            Metric(
                key="runway",
                label="Months you could cover",
                value=f"{runway:.1f} mo",
                number=runway,
                good_when="up",
            ),
            Metric(
                key="spend-vs",
                label="Spending vs last period",
                value=f"{'+' if spend_vs >= 0 else ''}{r2(spend_vs * 100)}%",
                number=spend_vs,
                delta=r2(spend_vs * 100),
                good_when="down",
            ),
        ]

    def calendar(self, ctx: Ctx, window: Window) -> list[CalendarItem]:
        """Bills and paydays, read-only on the calendar (IA ruling X-9)."""
        s = _state(ctx)
        out = []
        for o in calc.occurrences_in(s, window.first, window.last):
            if o.status == "skipped":
                continue
            kind = (
                "Payday"
                if o.item.type == "income"
                else "Transfer"
                if o.item.type == "transfer"
                else "Bill"
            )
            out.append(
                CalendarItem(
                    id=f"fin-{o.item.id}-{o.orig.isoformat()}",
                    day=o.day,
                    title=f"{kind} · {o.item.name}",
                    module="finance",
                    href=f"/finance/planned/{o.item.id}",
                    done=o.status == "paid",
                )
            )
        return out

    def misses(self, ctx: Ctx, window: Window) -> list[Miss]:
        s = _state(ctx)
        t = s.today
        sd = s.settings.month_start_day
        out: list[Miss] = []
        mk = calc.month_of(window.first, sd)
        last_mk = calc.month_of(window.last, sd)
        guard = 0
        while calc.month_index(mk, last_mk) >= 0 and guard < 24:
            _, mt = calc.month_range(mk, sd)
            for b in s.budgets:
                if b.archived:
                    continue
                v = calc.budget_view(s, b, mk)
                if v.pct > 1:
                    out.append(
                        Miss(
                            id=f"fin-budget-{b.id}-{mk}",
                            day=min(mt, t),
                            title=f"Over {b.name} budget by {r2((v.pct - 1) * 100)}% "
                            f"({_month_short(mk)})",
                            module="finance",
                            href=f"/finance/budgets/{b.id}",
                            kind="budget",
                        )
                    )
            mk = calc.add_months(mk, 1)
            guard += 1
        until = window.last if window.last < t else t - timedelta(days=1)
        if until >= window.first:
            for o in calc.occurrences_in(s, window.first, until):
                if o.status == "overdue":
                    out.append(
                        Miss(
                            id=f"fin-due-{o.item.id}-{o.orig.isoformat()}",
                            day=o.day,
                            title=f"Unpaid: {o.item.name}",
                            module="finance",
                            href=f"/finance/planned/{o.item.id}",
                            kind="unpaid",
                        )
                    )
        for r in s.records:
            if (
                r.day < window.first
                or r.day > window.last
                or not calc.is_flow(r)
                or r.type != "expense"
                or r.planned_id
                or r.amount < BIG_PURCHASE_MINOR
            ):
                continue
            out.append(
                Miss(
                    id=f"fin-big-{r.id}",
                    day=r.day,
                    title=f"Unplanned big purchase: {r.payee or 'expense'}",
                    module="finance",
                    href=f"/finance/records/{r.id}",
                    kind="big",
                )
            )
        out.sort(key=lambda m: m.day, reverse=True)
        return out

    def achievements(self, ctx: Ctx) -> list[Achievement]:
        """The prototype's finance contract declares none."""
        del ctx
        return []

    def facets(self, ctx: Ctx, window: Window, prev: Window) -> list[Facet]:
        """Percentages only (the share rule): savings rate, budget adherence,
        no-spend share of the window."""
        s = _state(ctx)
        if not s.accounts:
            return []
        cur = calc.flow_in(s, window.first, window.last)
        pre = calc.flow_in(s, prev.first, prev.last)
        ns = calc.no_spend_days(s, window.first, window.last)
        pns = calc.no_spend_days(s, prev.first, prev.last)
        bs = calc.budget_score(s)
        return [
            Facet(
                key="savings",
                label="Saving",
                module="finance",
                value=calc.clamp01(calc.savings_rate(cur) / 0.3),
                prev=calc.clamp01(calc.savings_rate(pre) / 0.3),
                metric_keys=("savings-rate",),
                href="/finance/reports",
            ),
            Facet(
                key="budgets",
                label="Budgets",
                module="finance",
                value=bs,
                prev=bs,
                off=not any(not b.archived for b in s.budgets),
                metric_keys=("budgets",),
                href="/finance/budgets",
            ),
            Facet(
                key="no-spend",
                label="No-spend days",
                module="finance",
                value=ns.count / len(ns.days) if ns.days else 0.0,
                prev=pns.count / len(pns.days) if pns.days else 0.0,
                metric_keys=("no-spend",),
                href="/finance/review",
            ),
        ]


def _month_short(mk: str) -> str:
    names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    return names[int(mk[5:7]) - 1]


contributor = FinanceContributor()
