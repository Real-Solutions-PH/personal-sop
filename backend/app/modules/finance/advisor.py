"""The advisor's deterministic answer (FIN-33 fallback).

The AI answer belongs to the companion session; this is the rule-based
answer the prototype shows (``finance-advisor-answer.tsx``), keyed by the
intent ``advisorQuestion`` reads from the question text. The companion can
return it verbatim when no model is available, or use it as grounding.

An answer is structured so the device can honour privacy mode: prose is a
list of paragraphs, each a list of segments — ``{"t": text}``,
``{"m": centavos}`` (render as full money) or ``{"k": centavos}`` (render
compact, ``₱12k``). Nothing here formats a peso amount into text.
"""

import math
import re
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from app.modules.finance import calc

Intent = Literal[
    "afford", "finance", "leaks", "emergency", "invest", "review", "generic"
]
DISCLAIMER = "Not licensed financial advice."


@dataclass(frozen=True)
class Question:
    key: Intent
    amount_minor: int | None = None
    n: int | None = None
    month: str | None = None
    name: str | None = None
    period: str | None = None


_NUM = re.compile(r"(\d+(?:\.\d+)?)\s*(k)?")


def advisor_question(text: str) -> Question:
    """Port of ``advisorQuestion``: the first number (``45k`` = 45,000) and
    the intent, tested in the prototype's order."""
    t = text.lower()
    m = _NUM.search(t)
    amount = (
        calc.js_round(float(m.group(1)) * (1000 if m.group(2) else 1) * 100)
        if m
        else None
    )
    if re.search(r"0%|financ|install|or pay cash", t):
        return Question("finance", amount_minor=amount or 3_000_000, n=12)
    if re.search(r"afford|buy|laptop|purchase", t):
        return Question("afford", amount_minor=amount or 4_500_000)
    if re.search(r"leak|where.*money|coffee|wasting", t):
        return Question("leaks")
    if re.search(r"emergency|runway|safety", t):
        return Question("emergency")
    if re.search(r"invest|mp2|index|stock", t):
        return Question("invest")
    if re.search(r"review|last month|how did i", t):
        return Question("review")
    return Question("generic")


Seg = dict[str, Any]


def _t(s: str) -> Seg:
    return {"t": s}


def _m(v: float) -> Seg:
    return {"m": calc.js_round(v)}


def _k(v: float) -> Seg:
    return {"k": calc.js_round(v)}


def month_label(mk: str, long: bool = False) -> str:
    y, m = mk.split("-")
    names = (
        "January February March April May June July August September October "
        "November December"
    ).split()
    name = names[int(m) - 1]
    return f"{name} {y}" if long else name[:3]


@dataclass
class _Ctx:
    avg_spend: float
    avg_income: float
    base: calc.Projection
    avg_u: float
    mk: str


def _context(s: calc.State) -> _Ctx:
    mk = calc.month_of(s.today, 1)
    spend = income = 0
    for i in range(1, 4):
        f, t = calc.month_range(calc.add_months(mk, -i), 1)
        fl = calc.flow_in(s, f, t)
        spend += fl.spend
        income += fl.income
    return _Ctx(
        avg_spend=spend / 3,
        avg_income=income / 3,
        base=calc.project(s, horizon=12, include_unplanned=True),
        avg_u=calc.avg_unplanned(s),
        mk=mk,
    )


def answer(
    s: calc.State,
    q: Question,
    *,
    scope: Literal["aggregates", "records"],
    safety_floor_minor: int,
    names: dict[str, str] | None = None,
) -> dict[str, Any]:
    """The structured answer for one question over a finance snapshot."""
    out: dict[str, Any] = {
        "intent": q.key,
        "paragraphs": [],
        "lesson": None,
        "working": [],
        "actions": [],
        "needs_records": False,
        "disclaimer": DISCLAIMER,
    }
    if q.key == "leaks" and scope == "aggregates":
        out["needs_records"] = True
        out["paragraphs"] = [
            [
                _t(
                    "To find repeat spending I need individual transactions. "
                    "Your current setting shares totals only."
                )
            ]
        ]
        out["actions"] = [
            {"kind": "allow_records", "label": "Allow records for this answer"}
        ]
        return out
    c = _context(s)
    floor = safety_floor_minor
    runway = c.base.start / c.avg_spend if c.avg_spend else 0.0
    paras: list[list[Seg]] = out["paragraphs"]
    work: list[dict[str, Any]] = out["working"]
    acts: list[dict[str, Any]] = out["actions"]

    if q.key == "afford":
        amount = q.amount_minor or 4_500_000
        month = q.month or f"{c.mk[:4]}-12"
        n = (q.n or 12) if (q.n or 1) > 1 else 1
        w = calc.project(
            s,
            horizon=12,
            include_unplanned=True,
            what_if=calc.WhatIf(amount, month, n),
        )
        ok = w.low.value >= floor
        neg = w.low.value < 0
        later = calc.add_months(month, 2)
        verdict = (
            "Not yet."
            if neg
            else "Yes — comfortably."
            if ok
            else "Yes, but it's tight."
        )
        out["verdict"] = "no" if neg else "ok" if ok else "tight"
        paras.append(
            [
                _t(f"{verdict} Buying a {q.name or 'purchase'} for "),
                _m(amount),
                _t(
                    f" in {month_label(month, True)}{f' on {n}× 0%' if n > 1 else ''}"
                    " takes your lowest balance to "
                ),
                _m(w.low.value),
                _t(f" ({month_label(w.low.key)}). "),
                *(
                    [_t("That stays above your "), _k(floor), _t(" minimum balance.")]
                    if ok
                    else [_t("You'd go negative.")]
                    if neg
                    else [_t("That's under your "), _k(floor), _t(" minimum balance.")]
                ),
            ]
        )
        recovery = w.recovery_months if w.recovery_months is not None else "a few"
        paras.append(
            [
                _t("My suggestion: "),
                _t(
                    f"Go ahead, but pay from savings in one go — you recover in about {recovery} months."
                    if ok
                    else f"Wait until {month_label(later, True)} or split it over 12× 0%, which keeps you above zero."
                    if neg
                    else f"Either push it to {month_label(later)} or use 0% installments so you stay above your minimum."
                ),
            ]
        )
        out["lesson"] = [
            _t(
                "A purchase is comfortable when your cash never dips below ~3 months "
                "of expenses. Yours is about "
            ),
            _k(c.avg_spend * 3),
            _t("."),
        ]
        work += [
            {"label": "Available now", "m": c.base.start},
            {"label": "Avg left over / month", "k": calc.js_round(c.base.avg_surplus)},
            {"label": "Avg everyday spending", "k": calc.js_round(c.avg_u)},
            {"label": "Lowest without it", "m": calc.js_round(c.base.low.value)},
            {"label": "Lowest with it", "m": calc.js_round(w.low.value)},
            {"label": "Minimum balance", "m": floor},
        ]
        acts += [
            {
                "kind": "what_if",
                "label": "Add as what-if",
                "amount_minor": amount,
                "month": month,
                "name": q.name or "Purchase",
            },
            {
                "kind": "planned",
                "label": "Save to plan",
                "prefill": {
                    "name": q.name or "Purchase",
                    "type": "expense",
                    "amount_minor": amount,
                    "category_slug": "shopping",
                    "schedule": {"kind": "once", "date": f"{month}-15"},
                },
            },
        ]
    elif q.key == "finance":
        amount = q.amount_minor or 3_000_000
        n = q.n or 12
        monthly = calc.js_round(amount / n)
        interest = calc.js_round(amount * 0.04 * (n / 12) * 0.5 * 0.8)
        paras.append(
            [
                _t("At a true 0%, installments are slightly better on paper: "),
                _m(monthly),
                _t(
                    f"/mo for {n} months, and the cash you keep can earn ~4% in a digital "
                    "bank — about "
                ),
                _k(interest),
                _t(" after tax over the term."),
            ]
        )
        paras.append(
            [
                _t(
                    "The real risk is behaviour: a missed payment costs ~3%/month plus fees, and "
                ),
                _t(f"{n} months of "),
                _m(monthly),
                _t(" eats into the "),
                _k(c.base.avg_surplus),
                _t("/mo you have left over."),
                _t(
                    " Your savings cover 3+ months, so 0% is fine if you set it as a "
                    "scheduled payment with autopay."
                    if runway >= 3
                    else " Your savings cover under 3 months — paying cash would leave you "
                    "exposed, so installments make sense here."
                ),
            ]
        )
        out["lesson"] = [
            _t(
                "“0%” often hides a processing fee or a higher price than cash. Ask for "
                "the cash price first; if it's lower by more than the interest you'd "
                "earn, pay cash."
            )
        ]
        work += [
            {"label": "Price", "m": amount},
            {"label": "Monthly", "m": monthly},
            {"label": "Interest kept (≈4% p.a., 20% tax)", "k": interest},
            {"label": "Months you could cover", "t": f"{runway:.1f} months"},
        ]
        acts += [
            {
                "kind": "planned",
                "label": "Add installment plan",
                "prefill": {
                    "name": "Phone — 0% installment",
                    "type": "transfer",
                    "amount_minor": monthly,
                    "is_installment": True,
                    "schedule": {"kind": "monthly", "day": 8},
                    "end_rule": {"kind": "count", "n": n},
                },
            },
            {
                "kind": "what_if",
                "label": "Compare in projection",
                "amount_minor": amount,
                "name": "Phone",
            },
        ]
    elif q.key == "leaks":
        since = s.today - timedelta(days=30)
        cats = calc.cat_map(s)
        by: dict[str, tuple[int, int]] = {}
        for r in s.records:
            if r.type != "expense" or r.day < since or not r.payee or r.planned_id:
                continue
            cat = cats.get(r.category_id or "")
            if cat is None or not cat.discretionary:
                continue
            n0, v0 = by.get(r.payee, (0, 0))
            by[r.payee] = (n0 + 1, v0 + r.amount)
        top = sorted(by.items(), key=lambda kv: -kv[1][1])[:4]
        subs_id = s.cat_by_slug.get("subs")
        subs = sum(
            p.amount
            for p in s.planned
            if subs_id and p.category_id == subs_id and not p.archived
        )
        paras.append(
            [
                _t(
                    "Looking at the last 30 days of transactions, these small repeats add up the most:"
                )
            ]
        )
        out["rows"] = [
            {"payee": name, "n": n, "m": v, "year_k": v * 12} for name, (n, v) in top
        ]
        paras.append(
            [
                _t("Suggestion: "),
                _t(
                    f"cap {top[0][0]} at half its current pace" if top else "keep going"
                ),
                _t(" and review subscriptions ("),
                _m(subs),
                _t("/mo) — cancelling one unused service is the easiest win."),
            ]
        )
        out["lesson"] = [
            _t(
                "Leaks are frequent, small, and feel free. Budgeting the category (not "
                "banning it) keeps it enjoyable."
            )
        ]
        acts += [
            {
                "kind": "budget",
                "label": "Create budget",
                "prefill": {
                    "name": "Coffee & treats",
                    "category_slugs": ["coffee"],
                    "limit_minor": 150_000,
                },
            },
            {"kind": "link", "label": "Open monthly review", "href": "/finance/review"},
        ]
    elif q.key == "emergency":
        target3 = c.avg_spend * 3
        target6 = c.avg_spend * 6
        paras.append(
            [
                _t("You spend about "),
                _m(c.avg_spend),
                _t(" a month. Your available cash is "),
                _m(c.base.start),
                _t(f" — enough to cover {runway:.1f} months."),
            ]
        )
        reach = max(
            1,
            math.ceil((target3 - c.base.start) / max(100, c.base.avg_surplus)),
        )
        paras.append(
            [
                _t("With two income sources, 3 months ("),
                _k(target3),
                _t(") is a reasonable minimum; 6 months ("),
                _k(target6),
                _t(") if either job feels shaky. "),
                *(
                    [_t("You're there — extra savings can start working harder.")]
                    if runway >= 3
                    else [
                        _t("Saving "),
                        _k(c.base.avg_surplus),
                        _t(f"/mo, you'd reach 3 months in about {reach} months."),
                    ]
                ),
            ]
        )
        out["lesson"] = [
            _t(
                "Keep the emergency fund boring and reachable — a high-yield savings "
                "account, not stocks or MP2."
            )
        ]
        work += [
            {"label": "Avg monthly spend (3 mo)", "m": calc.js_round(c.avg_spend)},
            {"label": "Available now", "m": c.base.start},
            {"label": "3-month target", "m": calc.js_round(target3)},
        ]
        acts.append(
            {
                "kind": "settings",
                "label": "Set minimum to 3 months",
                "patch": {
                    "safety_floor_minor": calc.js_round(target3 / 100_000) * 100_000
                },
            }
        )
    elif q.key == "invest":
        surplus = c.base.avg_surplus
        paras.append(
            [
                _t("Your plan leaves about "),
                _k(surplus),
                _t("/mo left over. Two common options in the Philippines:"),
            ]
        )
        paras.append(
            [
                _t(
                    "• Pag-IBIG MP2 — government-backed, dividends historically ~6–7%, "
                    "tax-free, 5-year lock-in. Good for money you won't touch."
                )
            ]
        )
        paras.append(
            [
                _t(
                    "• Index funds / ETFs — market returns, can drop 20–30% in a bad "
                    "year. Good for 5+ year money, added monthly."
                )
            ]
        )
        paras.append(
            [
                _t(
                    "Order that usually works: emergency fund first "
                    f"({'done ✓' if runway >= 3 else 'not yet'}), then split what's left "
                    "over — e.g. half MP2, half index funds."
                )
            ]
        )
        out["lesson"] = [
            _t(
                "Automate it on payday. Money that sits in an e-wallet tends to get spent."
            )
        ]
        acts.append(
            {
                "kind": "planned",
                "label": "Plan a monthly transfer",
                "prefill": {
                    "name": "MP2 savings",
                    "type": "transfer",
                    "amount_minor": 500_000,
                    "schedule": {"kind": "monthly", "day": 16},
                },
            }
        )
    elif q.key == "review":
        period = q.period or calc.add_months(c.mk, -1)
        f, t = calc.month_range(period, s.settings.month_start_day)
        fl = calc.flow_in(s, f, t)
        ranked = sorted(fl.by_cat.items(), key=lambda kv: -kv[1])
        top_id, top_v = ranked[0] if ranked else (None, 0)
        cat_name = (
            (names or {}).get(top_id or "")
            or next((x.name for x in s.categories if x.id == top_id), None)
            or "Uncategorised"
        )
        paras.append(
            [
                _t(f"In {month_label(period, True)} you earned "),
                _m(fl.income),
                _t(", spent "),
                _m(fl.spend),
                _t(f" and kept {calc.js_round(calc.savings_rate(fl) * 100)}%. "),
                _t(f"{cat_name} was the biggest bucket at "),
                _m(top_v),
                _t("."),
            ]
        )
        paras.append(
            [
                _t(
                    f"One change: set a weekly cap on {cat_name.lower()} and check it on "
                    "Sundays. Weekly limits are easier to feel than monthly ones."
                )
            ]
        )
        out["lesson"] = [
            _t(
                "Savings rate beats raw savings as a scorecard — it survives raises and bonuses."
            )
        ]
        acts.append(
            {
                "kind": "link",
                "label": "Open the full review",
                "href": f"/finance/review?period={period}",
            }
        )
    else:
        paras.append(
            [
                _t(
                    "I can help with: whether you can afford something, financing vs paying "
                    "cash, where money leaks, emergency funds, and investing basics (MP2, "
                    "index funds). I work from your own numbers and show my working — try "
                    "one of the suggestions below."
                )
            ]
        )
    return out
