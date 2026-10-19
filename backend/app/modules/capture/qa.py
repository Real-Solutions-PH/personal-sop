"""Deterministic answers to questions about the user's own data (prototype
``qa.ts``): the rules engine's answer cards, and the AI agent's ``lookup``
tool. Money in answer cards is integer centavos (``money``, ``bars.data``);
the text values are already formatted for a reader.
"""

import re
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

from app.modules.capture import ports
from app.modules.capture.models import JournalEntry
from app.modules.capture.money import peso
from app.modules.capture.parse import js_round, js_to_fixed
from app.shared import owned_repo
from app.shared.context import Ctx
from app.shared.day import js_weekday

Out = dict[str, Any]
SMTWTFS = "SMTWTFS"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

SPEND_CATS: list[tuple[str, str, str]] = [
    (r"\b(food|eating|kain)\b", "food", "Food"),
    (r"\b(dining|eating out|restaurants?|takeout|grab ?food)\b", "dining", "Dining out"),
    (r"\b(coffee|kape)\b", "coffee", "Coffee"),
    (r"\bgroceries|grocery\b", "groceries", "Groceries"),
    (r"\bgrab\b", "grab", "Grab rides"),
    (r"\b(transport|commute|transportation)\b", "transport", "Transport"),
    (r"\bbills?\b", "bills", "Bills"),
    (r"\b(subscriptions?|subs)\b", "subs", "Subscriptions"),
    (r"\bshopping\b", "shopping", "Shopping"),
    (r"\bentertainment|fun\b", "entertainment", "Entertainment"),
    (r"\bhealth|medicine\b", "health", "Health"),
    (r"\brent\b", "rent", "Rent"),
]
EX_Q: list[tuple[str, str]] = [
    (r"\bbench\b", "bench"),
    (r"\bsquat\b", "squat"),
    (r"\b(ohp|overhead)\b", "overhead"),
    (r"\brdl|romanian\b", "romanian"),
    (r"\brow\b", "row"),
    (r"\bpull ?-?ups?\b", "pull-up"),
    (r"\bpulldown|lat\b", "pulldown"),
    (r"\bincline\b", "incline"),
    (r"\bcurl\b", "curl"),
    (r"\bleg press\b", "leg press"),
]
A = re.ASCII


def _t(pattern: str, s: str) -> bool:
    return re.search(pattern, s, A) is not None


def fmt_day(d: date) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}"


def _title(s: str) -> str:
    return re.sub(r"\b\w", lambda m: m.group(0).upper(), s, flags=A)


def period(ctx: Ctx, q: str, month_start_day: int) -> tuple[date, date, str]:
    FC, XC, _ = ports.calc_modules()
    t = ctx.today
    if _t(r"\btoday\b|\bngayon\b", q):
        return t, t, "today"
    if _t(r"\byesterday\b|\bkahapon\b", q):
        y = t - timedelta(days=1)
        return y, y, "yesterday"
    if _t(r"\blast week\b", q):
        ws = XC.week_start(t)
        a, b = ws - timedelta(days=7), ws - timedelta(days=1)
        return a, b, f"{fmt_day(a)}–{fmt_day(b)}"
    if _t(r"\b(this week|week)\b", q):
        a = XC.week_start(t)
        return a, t, f"{fmt_day(a)}–{fmt_day(t)}"
    if _t(r"\blast month\b", q):
        first = FC.month_range(FC.month_of(t, month_start_day), month_start_day)[0]
        mk = FC.month_of(first - timedelta(days=1), month_start_day)
        a, b = FC.month_range(mk, month_start_day)
        return a, b, f"{fmt_day(a)}–{fmt_day(b)}"
    a = FC.month_range(FC.month_of(t, month_start_day), month_start_day)[0]
    return a, t, f"{fmt_day(a)}–{fmt_day(t)}"


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


def spend_answer(ctx: Ctx, q: str) -> Out:
    FC, _, _ = ports.calc_modules()
    s = ports.finance_state(ctx)
    cats = FC.cat_map(s)
    hit = next(((slug, name) for rx, slug, name in SPEND_CATS if _t(rx, q)), None)
    cid = s.cat_by_slug.get(hit[0]) if hit else None
    ids = [cid] if cid else None
    name = hit[1] if hit else "everything"
    first, last, label = period(ctx, q, s.settings.month_start_day)
    total = FC.spend_in(s, first, last, ids, cats)
    recs = [
        r
        for r in s.records
        if r.type == "expense"
        and FC.is_flow(r)
        and first <= r.day <= last
        and (
            not ids
            or r.category_id == ids[0]
            or (r.category_id in cats and cats[r.category_id].parent_id == ids[0])
        )
    ]
    budget = next(
        (
            b
            for b in s.budgets
            if not b.archived
            and (
                (b.category_ids is not None and len(b.category_ids) == 1 and b.category_ids[0] == cid)
                if ids
                else b.category_ids is None
            )
        ),
        None,
    )
    bv = (
        FC.budget_view(s, budget)
        if budget and (first.year, first.month) == (ctx.today.year, ctx.today.month)
        else None
    )
    days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    labels: list[str] = []
    data: list[int] = []
    if len(days) <= 8:
        labels = [SMTWTFS[js_weekday(d)] for d in days]
        data = [sum(r.amount for r in recs if r.day == d) for d in days]
    else:
        for i in range(0, len(days), 7):
            chunk = set(days[i : i + 7])
            labels.append(f"W{len(labels) + 1}")
            data.append(sum(r.amount for r in recs if r.day in chunk))
    by_payee: dict[str, int] = {}
    for r in recs:
        key = r.payee or (cats[r.category_id].name if r.category_id in cats else "Other")
        by_payee[key] = by_payee.get(key, 0) + r.amount
    top = sorted(by_payee.items(), key=lambda kv: -kv[1])[:3]
    n = len(recs)
    out: Out = {
        "t": "answer",
        "title": f"Spent on {name} · {label}",
        "value": peso(total),
        "money": total,
        "accent": "fin",
        "list": [{"label": k, "value": peso(v)} for k, v in top],
        "basis": f"Based on {n} transaction{_plural(n, '', 's')} · {label}",
        "links": [{"label": "Open in Finance", "href": "/finance/reports/category"}]
        + ([{"label": "Budget", "href": f"/finance/budgets/{budget.id}"}] if budget else []),
    }
    if bv is not None and budget is not None:
        out["sub"] = (
            f"{js_round(bv.pct * 100)}% of your {peso(bv.limit)} {budget.name} budget · "
            f"{bv.days_left} days left"
        )
    if len(data) > 1:
        out["bars"] = {"labels": labels, "data": data}
    return out


def balance_answer(ctx: Ctx, q: str) -> Out:
    FC, _, _ = ports.calc_modules()
    s = ports.finance_state(ctx)
    bal = FC.balances(s)
    live = [a for a in s.accounts if not a.archived]
    acct = next((a for a in live if a.name and a.name.lower().split(" ")[0] in q), None)
    if acct is not None:
        v = bal.get(acct.id, 0)
        return {
            "t": "answer",
            "title": f"{acct.name} balance",
            "value": peso(v),
            "money": v,
            "accent": "fin",
            "basis": "As of your last entry",
            "links": [{"label": "Open account", "href": f"/finance/accounts/{acct.id}"}],
        }
    nw = FC.net_worth(s, bal)
    return {
        "t": "answer",
        "title": "Net worth",
        "value": peso(nw),
        "money": nw,
        "accent": "fin",
        "list": [
            {
                "label": a.name,
                "value": peso(bal.get(a.id, 0)),
                "href": f"/finance/accounts/{a.id}",
            }
            for a in live
        ],
        "basis": f"{len(live)} accounts",
        "links": [{"label": "Open Finance", "href": "/finance"}],
    }


def pr_answer(ctx: Ctx, q: str) -> Out:
    _, XC, _ = ports.calc_modules()
    s = ports.fitness_state(ctx)
    key = next((k for rx, k in EX_Q if _t(rx, q)), None)
    ex = (
        next((e for e in s.exercises if key in e.name.lower()), None) if key else None
    )
    if ex is None:
        return {
            "t": "info",
            "tone": "fallback",
            "title": "Which lift?",
            "body": "I track PRs per exercise.",
            "actions": [
                {"label": _title(x), "do": "prompt", "prompt": f"what's my {x} PR?"}
                for x in ("bench", "squat", "overhead press", "row")
            ],
        }
    hist = XC.exercise_history(s, ex.id)
    link = [{"label": "Open exercise", "href": f"/fitness/exercises/{ex.id}"}]
    if not hist:
        return {
            "t": "answer",
            "title": f"{ex.name} PR",
            "value": "No sessions yet",
            "accent": "fit",
            "links": link,
        }
    best = hist[0]
    for h in hist[1:]:
        if h.stats.best_e1rm > best.stats.best_e1rm:
            best = h
    heaviest = max(h.stats.heaviest for h in hist)
    top = best.stats.top
    when = fmt_day(s.day(best.workout.started_at))
    return {
        "t": "answer",
        "title": f"{ex.name} PR",
        "value": f"{_n(top.weight)} kg × {top.reps}" if top else f"{js_round(best.stats.best_e1rm)} kg",
        "sub": f"{when} · est. 1-rep max {js_round(best.stats.best_e1rm)} kg · heaviest {_n(heaviest)} kg",
        "accent": "fit",
        "spark": [js_round(h.stats.best_e1rm) for h in hist[-12:]],
        "basis": f"Based on {len(hist)} sessions",
        "links": link,
    }


def _n(x: float) -> str:
    return str(int(x)) if x == int(x) else repr(x)


def weight_answer(ctx: Ctx) -> Out:
    _, XC, _ = ports.calc_modules()
    s = ports.fitness_state(ctx)
    cur = XC.latest_bodyweight(s)
    since = ctx.today - timedelta(days=30)
    series = [v for k, v in sorted(XC.daily_weights(s).items()) if k >= since]
    out: Out = {
        "t": "answer",
        "title": "Body weight",
        "value": f"{_n(cur)} kg" if cur else "No weigh-ins",
        "accent": "fit",
        "spark": series,
        "basis": f"Based on {len(series)} weigh-ins · last 30 days",
        "links": [{"label": "Open body", "href": "/fitness/body"}],
    }
    if len(series) > 1:
        d = series[-1] - series[0]
        out["sub"] = f"{'▼' if d <= 0 else '▲'} {js_to_fixed(abs(d), 1)} kg in 30 days"
    return out


def _habits(ctx: Ctx, days: int = 400) -> tuple[Any, Any]:
    w = ports.habits_world(ctx, ctx.today - timedelta(days=days))
    return w, [v for v in w.habit_list() if v.status != "archived"]


def habits_answer(ctx: Ctx, q: str) -> Out:
    _, XC, HL = ports.calc_modules()
    w, hs = _habits(ctx)
    last_week = _t(r"\blast week\b", q)
    ws = XC.week_start(ctx.today)
    first = ws - timedelta(days=7) if last_week else ws
    last = ws - timedelta(days=1) if last_week else ctx.today
    days = HL.overall_days(hs, w.idx, first, last, ctx.today)
    done = sum(d.done for d in days)
    due = sum(d.due for d in days)
    out: Out = {
        "t": "answer",
        "title": f"Habits {'last week' if last_week else 'this week'}",
        "value": f"{done} of {due}",
        "accent": "hab",
        "bars": {
            "labels": [SMTWTFS[js_weekday(d.day)] for d in days],
            "data": [d.done for d in days],
        },
        "basis": f"{len(hs)} active habits · {len(days)} days",
        "links": [{"label": "Open habits", "href": "/habits"}],
    }
    if due:
        out["sub"] = f"{js_round(done / due * 100)}% completion"
    return out


def streak_answer(ctx: Ctx) -> Out:
    _, _, HL = ports.calc_modules()
    w, _ = _habits(ctx)
    rows = sorted(
        (
            (v, HL.streaks(v, w.idx, ctx.today).current)
            for v in w.habit_list()
            if v.status == "active"
        ),
        key=lambda r: -r[1],
    )[:4]
    out: Out = {
        "t": "answer",
        "title": "Current streaks",
        "value": f"{rows[0][1]} days" if rows else "No streaks yet",
        "accent": "hab",
        "list": [
            {"label": f"{v.icon} {v.name}", "value": f"{n} d", "href": f"/habits/{v.id}"}
            for v, n in rows[1:]
        ],
        "links": [{"label": "Open habits", "href": "/habits"}],
    }
    if rows:
        out["sub"] = f"{rows[0][0].name} — your longest current streak"
    return out


def habits_left_answer(ctx: Ctx) -> Out:
    _, _, HL = ports.calc_modules()
    w, _ = _habits(ctx, days=2)
    t = ctx.today
    left = [
        v
        for v in w.habit_list()
        if HL.is_due(v, t)
        and (w.idx.get((v.id, t)) is None or w.idx[(v.id, t)].status != "done")
    ]
    return {
        "t": "answer",
        "title": "Habits left today",
        "value": f"{len(left)} to go" if left else "All done",
        "accent": "hab",
        "list": [
            {"label": f"{v.icon} {v.name}", "value": "", "href": f"/habits/{v.id}"}
            for v in left
        ],
        "links": [{"label": "Open habits", "href": "/habits/today"}],
    }


def tasks_answer(ctx: Ctx, q: str) -> Out:
    t = ctx.today
    rows = ports.open_task_rows(ctx)
    overdue = _t(r"\boverdue|late\b", q)
    tomorrow = _t(r"\btomorrow|bukas\b", q)
    target = t + timedelta(days=1) if tomorrow else t
    hit = [
        x
        for x in rows
        if x.due_date is not None
        and (
            x.due_date < t
            if overdue
            else (x.due_date == target if tomorrow else x.due_date <= target)
        )
    ]
    n = len(hit)
    return {
        "t": "answer",
        "title": "Overdue tasks"
        if overdue
        else "Due tomorrow"
        if tomorrow
        else "Due today (incl. overdue)",
        "value": f"{n} task{_plural(n, '', 's')}" if n else "Nothing due",
        "accent": "tsk",
        "list": [
            {
                "label": x.title,
                "value": "overdue" if x.due_date and x.due_date < t else (x.due_time or ""),
                "href": f"/tasks/task/{x.id}",
            }
            for x in hit[:6]
        ],
        "basis": f"{len(rows)} open tasks",
        "links": [{"label": "Open tasks", "href": "/tasks"}],
    }


def macros_answer(ctx: Ctx) -> Out:
    left = ports.macros_left_today(ctx)
    if left is None:
        return {
            "t": "answer",
            "title": "Macros left today",
            "value": "No target set",
            "accent": "fit",
            "links": [{"label": "Set targets", "href": "/fitness/nutrition/targets"}],
        }
    kcal, protein, carbs, fat = left
    return {
        "t": "answer",
        "title": "Left for today",
        "value": f"{js_round(kcal):,} kcal",
        "sub": f"{js_round(protein)} g protein · {js_round(carbs)} g carbs · {js_round(fat)} g fat",
        "accent": "fit",
        "links": [{"label": "Open nutrition", "href": "/fitness/nutrition"}],
    }


def workouts_answer(ctx: Ctx) -> Out:
    _, XC, _ = ports.calc_modules()
    s = ports.fitness_state(ctx)
    weeks = XC.sessions_by_week(s, 8, ctx.today)
    cur = weeks[-1].count if weeks else 0
    n = len(weeks)
    return {
        "t": "answer",
        "title": "Workouts this week",
        "value": f"{cur} of {s.settings.weekly_target}",
        "accent": "fit",
        "bars": {
            "labels": ["now" if i == n - 1 else f"-{n - 1 - i}w" for i in range(n)],
            "data": [w.count for w in weeks],
        },
        "basis": "Last 8 weeks",
        "links": [{"label": "Open fitness", "href": "/fitness"}],
    }


def journal_answer(ctx: Ctx, q: str, *, allowed: bool) -> Out:
    if not allowed:
        return {
            "t": "info",
            "tone": "advice",
            "title": "Your journal is private from Q&A",
            "body": "I don't read journal entries to answer questions unless you turn that on.",
            "actions": [
                {"label": "Open journal", "do": "link", "href": "/journal"},
                {"label": "AI settings", "do": "link", "href": "/capture/settings"},
            ],
        }
    stripped = re.sub(r"\b(what|did|i|write|wrote|about|journal|my|in|the)\b", "", q.lower(), flags=A)
    ws = [w for w in re.split(r"\s+", stripped.strip()) if len(w) > 2]
    rows = owned_repo.list_rows(ctx, JournalEntry, order_by=[JournalEntry.created_at])
    hits = [j for j in rows if any(w in j.body.lower() for w in ws)]
    n = len(hits)
    return {
        "t": "answer",
        "title": "From your journal",
        "value": f"{n} entr{'y' if n == 1 else 'ies'}",
        "accent": "life",
        "list": [
            {
                "label": j.body[:48] + ("…" if len(j.body) > 48 else ""),
                "value": j.day.isoformat()[5:],
                "href": f"/journal/{j.id}",
            }
            for j in hits[:4]
        ],
        "links": [{"label": "Open journal", "href": "/journal"}],
    }


def advice_answer(ctx: Ctx, q: str) -> Out:
    FC, _, _ = ports.calc_modules()
    m = re.search(r"(\d[\d,]*)(k)?", q, A)
    amount = int(m.group(1).replace(",", "")) * (1000 if m.group(2) else 1) if m else None
    tm = re.search(
        r"\bbuy (?:a |an |this |the )?([a-z ]{2,20}?)(?: on| for| with|\?|$)", q, re.I | A
    )
    thing = tm.group(1).strip() if tm else "this"
    inst = _t(r"install?ment|0%|hulugan", q)
    s = ports.finance_state(ctx)
    since = ctx.today - timedelta(days=90)
    spend = income = 0
    for r in s.records:
        if not FC.is_flow(r) or r.day < since:
            continue
        if r.type == "expense":
            spend += r.amount
        elif r.type == "income" and not r.is_refund:
            income += r.amount
    free = max(0, (income - spend) / 3)
    extra = ""
    if amount:
        per = f" over 12 months is {peso(amount * 100 / 12)}/mo" if inst else ""
        extra = f" {peso(amount * 100)}{per}."
    href = (
        f"/finance/advisor?ask=afford&name={quote(thing)}"
        f"{f'&amount={amount}' if amount else ''}&mode={'inst' if inst else 'lump'}&n=12"
    )
    short = (
        "0% installment is fine if the monthly fits"
        if inst
        else "check how many months your savings cover first"
    )
    return {
        "t": "info",
        "tone": "advice",
        "title": f"Short answer: {short}",
        "body": f"You've kept about {peso(free)} a month free over the last 90 days.{extra} "
        "The Finance advisor can run it against your projection.",
        "actions": [{"label": "Ask Finance advisor", "do": "link", "href": href}],
    }


FALLBACK: Out = {
    "t": "info",
    "tone": "fallback",
    "title": "I can't answer that one yet",
    "body": "I can answer about spending, balances, PRs, weight, habits, streaks, tasks, macros and workouts.",
    "actions": [
        {
            "label": "Food spend this month",
            "do": "prompt",
            "prompt": "how much did I spend on food this month?",
        },
        {"label": "Bench PR", "do": "prompt", "prompt": "what's my bench PR?"},
        {
            "label": "Habits this week",
            "do": "prompt",
            "prompt": "how many habits did I do this week?",
        },
    ],
}


def route(q: str) -> str:
    """Which answer a question gets (``answer``'s dispatch, pure)."""
    if _t(r"^(should i|can i afford|is it worth|worth it)\b", q):
        return "advice"
    if _t(r"\bjournal|wrote|write about\b", q):
        return "journal"
    if _t(r"\b(spend|spent|spending|gastos|magkano.*(gastos|nagastos))\b", q):
        return "spend"
    if _t(r"\b(balance|net worth|how much (do i have|is in|money)|laman)\b", q):
        return "balance"
    if _t(r"\b(pr|personal record|max|1rm|heaviest|best)\b", q):
        return "pr"
    if _t(r"\b(weigh|weight|timbang)\b", q):
        return "weight"
    if _t(r"\bstreaks?\b", q):
        return "streak"
    if _t(r"\bhabits?\b", q) and _t(r"\b(left|remaining|pending|to do|still)\b", q):
        return "habits_left"
    if _t(r"\bhabits?\b", q):
        return "habits"
    if _t(r"\b(protein|calories|kcal|macros?|carbs|fat)\b", q):
        return "macros"
    if _t(r"\b(workouts?|gym|sessions?|trained)\b", q):
        return "workouts"
    if _t(r"\b(tasks?|due|to-?dos?|overdue|what do i have)\b", q):
        return "tasks"
    return "fallback"


def answer(ctx: Ctx, question: str, *, journal_in_qa: bool = False) -> Out:
    q = question.lower()
    which = route(q)
    table: dict[str, Callable[[], Out]] = {
        "advice": lambda: advice_answer(ctx, q),
        "journal": lambda: journal_answer(ctx, q, allowed=journal_in_qa),
        "spend": lambda: spend_answer(ctx, q),
        "balance": lambda: balance_answer(ctx, q),
        "pr": lambda: pr_answer(ctx, q),
        "weight": lambda: weight_answer(ctx),
        "streak": lambda: streak_answer(ctx),
        "habits_left": lambda: habits_left_answer(ctx),
        "habits": lambda: habits_answer(ctx, q),
        "macros": lambda: macros_answer(ctx),
        "workouts": lambda: workouts_answer(ctx),
        "tasks": lambda: tasks_answer(ctx, q),
    }
    fn = table.get(which)
    return fn() if fn else dict(FALLBACK)
