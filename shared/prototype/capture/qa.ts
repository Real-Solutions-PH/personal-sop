"use client"
import {
  balances,
  budgetView,
  catMap,
  addDays as finAddDays,
  isFlow,
  monthOf,
  monthRange,
  netWorth,
  recDay,
  spendIn,
} from "../finance/calc"
import { finStore } from "../finance/store"
import { macrosLeftToday } from "../fitness/actions"
import {
  dailyWeights,
  exerciseHistory,
  latestBodyweight,
  sessionsByWeek,
  weekStart,
} from "../fitness/calc"
import { fitStore } from "../fitness/store"
import { isDue, lk, logIndex, overallDays, streaks } from "../habits/logic"
import { habitsStore } from "../habits/store"
import { dayKey, dayOffset } from "../lib/day"
import { money } from "../lib/money"
import { tasksStore } from "../tasks/store"
import type { AnswerCard, InfoCard } from "./data"
import { captureStore } from "./store"

type Out = Omit<AnswerCard, "id"> | Omit<InfoCard, "id">
const SPEND_CATS: [RegExp, string, string][] = [
  [/\b(food|eating|kain)\b/, "food", "Food"],
  [
    /\b(dining|eating out|restaurants?|takeout|grab ?food)\b/,
    "dining",
    "Dining out",
  ],
  [/\b(coffee|kape)\b/, "coffee", "Coffee"],
  [/\bgroceries|grocery\b/, "groceries", "Groceries"],
  [/\bgrab\b/, "grab", "Grab rides"],
  [/\b(transport|commute|transportation)\b/, "transport", "Transport"],
  [/\bbills?\b/, "bills", "Bills"],
  [/\b(subscriptions?|subs)\b/, "subs", "Subscriptions"],
  [/\bshopping\b/, "shopping", "Shopping"],
  [/\bentertainment|fun\b/, "entertainment", "Entertainment"],
  [/\bhealth|medicine\b/, "health", "Health"],
  [/\brent\b/, "rent", "Rent"],
]
const EX_Q: [RegExp, string][] = [
  [/\bbench\b/, "bench"],
  [/\bsquat\b/, "squat"],
  [/\b(ohp|overhead)\b/, "ohp"],
  [/\brdl|romanian\b/, "rdl"],
  [/\brow\b/, "row"],
  [/\bpull ?-?ups?\b/, "pullup"],
  [/\bpulldown|lat\b/, "pulldown"],
  [/\bincline\b/, "incline"],
  [/\bcurl\b/, "curl"],
  [/\bleg press\b/, "legpress"],
]
function period(q: string): {
  from: string
  to: string
  label: string
} {
  const t = dayKey()
  const sd = finStore.get().settings.monthStartDay
  const fmt = (k: string) =>
    new Date(`${k}T12:00:00`).toLocaleDateString("en-PH", {
      month: "short",
      day: "numeric",
    })
  if (/\btoday\b|\bngayon\b/.test(q)) return { from: t, to: t, label: "today" }
  if (/\byesterday\b|\bkahapon\b/.test(q)) {
    const y = dayOffset(-1)
    return { from: y, to: y, label: "yesterday" }
  }
  if (/\blast week\b/.test(q)) {
    const ws = weekStart(t)
    const from = finAddDays(ws, -7)
    return {
      from,
      to: finAddDays(ws, -1),
      label: `${fmt(from)}–${fmt(finAddDays(ws, -1))}`,
    }
  }
  if (/\b(this week|week)\b/.test(q)) {
    const from = weekStart(t)
    return { from, to: t, label: `${fmt(from)}–${fmt(t)}` }
  }
  if (/\blast month\b/.test(q)) {
    const mk = monthOf(finAddDays(monthRange(monthOf(t, sd), sd)[0], -1), sd)
    const [from, to] = monthRange(mk, sd)
    return { from, to, label: `${fmt(from)}–${fmt(to)}` }
  }
  const [from] = monthRange(monthOf(t, sd), sd)
  return { from, to: t, label: `${fmt(from)}–${fmt(t)}` }
}
function spendAnswer(q: string): Out {
  const s = finStore.get()
  const cats = catMap(s)
  const hit = SPEND_CATS.find(([re]) => re.test(q))
  const ids = hit ? [hit[1]] : null
  const name = hit ? hit[2] : "everything"
  const p = period(q)
  const total = spendIn(s, p.from, p.to, ids, cats)
  const recs = s.records.filter(
    (r) =>
      r.type === "expense" &&
      isFlow(r) &&
      recDay(r) >= p.from &&
      recDay(r) <= p.to &&
      (!ids ||
        r.categoryId === ids[0] ||
        cats.get(r.categoryId ?? "")?.parentId === ids[0]),
  )
  const budget = s.budgets.find(
    (b) =>
      !b.archived &&
      (ids
        ? b.categoryIds?.length === 1 && b.categoryIds[0] === ids[0]
        : b.categoryIds === null),
  )
  const bv =
    budget && p.from.slice(0, 7) === dayKey().slice(0, 7)
      ? budgetView(s, budget)
      : undefined
  const days: string[] = []
  for (let k = p.from; k <= p.to; k = finAddDays(k, 1)) days.push(k)
  let labels: string[] = []
  let data: number[] = []
  if (days.length <= 8) {
    labels = days.map((k) => "SMTWTFS"[new Date(`${k}T12:00:00`).getDay()])
    data = days.map((k) =>
      recs.filter((r) => recDay(r) === k).reduce((a, r) => a + r.amount, 0),
    )
  } else {
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7)
      labels.push(`W${labels.length + 1}`)
      data.push(
        recs
          .filter((r) => chunk.includes(recDay(r)))
          .reduce((a, r) => a + r.amount, 0),
      )
    }
  }
  const byPayee = new Map<string, number>()
  for (const r of recs) {
    const key = r.payee ?? cats.get(r.categoryId ?? "")?.name ?? "Other"
    byPayee.set(key, (byPayee.get(key) ?? 0) + r.amount)
  }
  const top = [...byPayee.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return {
    t: "answer",
    title: `Spent on ${name} · ${p.label}`,
    value: money(total),
    money: total,
    sub: bv
      ? `${Math.round(bv.pct * 100)}% of your ${money(bv.limit)} ${budget?.name} budget · ${bv.daysLeft} days left`
      : undefined,
    accent: "fin",
    bars: data.length > 1 ? { labels, data } : undefined,
    list: top.map(([k, v]) => ({ label: k, value: money(v) })),
    basis: `Based on ${recs.length} transaction${recs.length === 1 ? "" : "s"} · ${p.label}`,
    links: [
      { label: "Open in Finance", href: "/finance/reports/category" },
      ...(budget
        ? [{ label: "Budget", href: `/finance/budgets/${budget.id}` }]
        : []),
    ],
  }
}
function balanceAnswer(q: string): Out {
  const s = finStore.get()
  const bal = balances(s)
  const acct = s.accounts.find(
    (a) => !a.archived && q.includes(a.name.toLowerCase().split(" ")[0]),
  )
  if (acct)
    return {
      t: "answer",
      title: `${acct.name} balance`,
      value: money(bal[acct.id] ?? 0),
      money: bal[acct.id] ?? 0,
      accent: "fin",
      basis: "As of your last entry",
      links: [{ label: "Open account", href: `/finance/accounts/${acct.id}` }],
    }
  const nw = netWorth(s, bal)
  return {
    t: "answer",
    title: "Net worth",
    value: money(nw),
    money: nw,
    accent: "fin",
    list: s.accounts
      .filter((a) => !a.archived)
      .map((a) => ({
        label: a.name,
        value: money(bal[a.id] ?? 0),
        href: `/finance/accounts/${a.id}`,
      })),
    basis: `${s.accounts.filter((a) => !a.archived).length} accounts`,
    links: [{ label: "Open Finance", href: "/finance" }],
  }
}
function prAnswer(q: string): Out {
  const s = fitStore.get()
  const key = EX_Q.find(([re]) => re.test(q))?.[1]
  const ex = key
    ? s.exercises.find(
        (e) =>
          e.id === key ||
          e.id.startsWith(key) ||
          e.name.toLowerCase().includes(key),
      )
    : undefined
  if (!ex)
    return {
      t: "info",
      tone: "fallback",
      title: "Which lift?",
      body: "I track PRs per exercise.",
      actions: ["bench", "squat", "overhead press", "row"].map((x) => ({
        label: title(x),
        do: "prompt" as const,
        prompt: `what's my ${x} PR?`,
      })),
    }
  const hist = exerciseHistory(s, ex.id)
  if (!hist.length)
    return {
      t: "answer",
      title: `${ex.name} PR`,
      value: "No sessions yet",
      accent: "fit",
      links: [{ label: "Open exercise", href: `/fitness/exercises/${ex.id}` }],
    }
  const best = hist.reduce((a, b) =>
    b.stats.bestE1rm > a.stats.bestE1rm ? b : a,
  )
  const heaviest = Math.max(...hist.map((h) => h.stats.heaviest))
  const top = best.stats.top
  const when = new Date(best.workout.startedAt).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })
  return {
    t: "answer",
    title: `${ex.name} PR`,
    value: top
      ? `${top.weight} kg × ${top.reps}`
      : `${Math.round(best.stats.bestE1rm)} kg`,
    sub: `${when} · est. 1-rep max ${Math.round(best.stats.bestE1rm)} kg · heaviest ${heaviest} kg`,
    accent: "fit",
    spark: hist.slice(-12).map((h) => Math.round(h.stats.bestE1rm)),
    basis: `Based on ${hist.length} sessions`,
    links: [{ label: "Open exercise", href: `/fitness/exercises/${ex.id}` }],
  }
}
function weightAnswer(): Out {
  const s = fitStore.get()
  const cur = latestBodyweight(s)
  const dw = dailyWeights(s)
  const from = dayOffset(-30)
  const series = [...dw.entries()]
    .filter(([k]) => k >= from)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v)
  const delta = series.length > 1 ? series.at(-1)! - series[0] : 0
  return {
    t: "answer",
    title: "Body weight",
    value: cur ? `${cur} kg` : "No weigh-ins",
    sub:
      series.length > 1
        ? `${delta <= 0 ? "▼" : "▲"} ${Math.abs(delta).toFixed(1)} kg in 30 days`
        : undefined,
    accent: "fit",
    spark: series,
    basis: `Based on ${series.length} weigh-ins · last 30 days`,
    links: [{ label: "Open body", href: "/fitness/body" }],
  }
}
function habitsAnswer(q: string): Out {
  const st = habitsStore.get()
  const t = dayKey()
  const lastWeek = /\blast week\b/.test(q)
  const ws = weekStart(t)
  const from = lastWeek ? finAddDays(ws, -7) : ws
  const to = lastWeek ? finAddDays(ws, -1) : t
  const hs = st.habits.filter((h) => h.status !== "archived")
  const idx = logIndex(st.logs)
  const days = overallDays(hs, idx, from, to, t)
  const done = days.reduce((a, d) => a + d.done, 0)
  const due = days.reduce((a, d) => a + d.due, 0)
  return {
    t: "answer",
    title: `Habits ${lastWeek ? "last week" : "this week"}`,
    value: `${done} of ${due}`,
    sub: due ? `${Math.round((done / due) * 100)}% completion` : undefined,
    accent: "hab",
    bars: {
      labels: days.map(
        (d) => "SMTWTFS"[new Date(`${d.day}T12:00:00`).getDay()],
      ),
      data: days.map((d) => d.done),
    },
    basis: `${hs.length} active habits · ${days.length} days`,
    links: [{ label: "Open habits", href: "/habits" }],
  }
}
function streakAnswer(): Out {
  const st = habitsStore.get()
  const idx = logIndex(st.logs)
  const rows = st.habits
    .filter((h) => h.status === "active")
    .map((h) => ({ h, s: streaks(h, idx).current }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 4)
  return {
    t: "answer",
    title: "Current streaks",
    value: rows[0] ? `${rows[0].s} days` : "No streaks yet",
    sub: rows[0]
      ? `${rows[0].h.name} — your longest current streak`
      : undefined,
    accent: "hab",
    list: rows.slice(1).map((r) => ({
      label: `${r.h.icon} ${r.h.name}`,
      value: `${r.s} d`,
      href: `/habits/${r.h.id}`,
    })),
    links: [{ label: "Open habits", href: "/habits" }],
  }
}
function habitsLeftAnswer(): Out {
  const st = habitsStore.get()
  const t = dayKey()
  const idx = logIndex(st.logs)
  const left = st.habits.filter(
    (h) => isDue(h, t) && idx.get(lk(h.id, t))?.status !== "done",
  )
  return {
    t: "answer",
    title: "Habits left today",
    value: left.length ? `${left.length} to go` : "All done",
    accent: "hab",
    list: left.map((h) => ({
      label: `${h.icon} ${h.name}`,
      value: "",
      href: `/habits/${h.id}`,
    })),
    links: [{ label: "Open habits", href: "/habits/today" }],
  }
}
function tasksAnswer(q: string): Out {
  const t = dayKey()
  const open = tasksStore.get().tasks.filter((x) => x.status === "open")
  const overdue = /\boverdue|late\b/.test(q)
  const tomorrow = /\btomorrow|bukas\b/.test(q)
  const target = tomorrow ? dayOffset(1) : t
  const rows = open.filter((x) =>
    overdue
      ? !!x.dueDate && x.dueDate < t
      : !!x.dueDate && (tomorrow ? x.dueDate === target : x.dueDate <= target),
  )
  return {
    t: "answer",
    title: overdue
      ? "Overdue tasks"
      : tomorrow
        ? "Due tomorrow"
        : "Due today (incl. overdue)",
    value: rows.length
      ? `${rows.length} task${rows.length === 1 ? "" : "s"}`
      : "Nothing due",
    accent: "tsk",
    list: rows.slice(0, 6).map((x) => ({
      label: x.title,
      value: x.dueDate && x.dueDate < t ? "overdue" : (x.dueTime ?? ""),
      href: `/tasks/task/${x.id}`,
    })),
    basis: `${open.length} open tasks`,
    links: [{ label: "Open tasks", href: "/tasks" }],
  }
}
function macrosAnswer(): Out {
  const left = macrosLeftToday()
  if (!left)
    return {
      t: "answer",
      title: "Macros left today",
      value: "No target set",
      accent: "fit",
      links: [{ label: "Set targets", href: "/nutrition/targets" }],
    }
  return {
    t: "answer",
    title: "Left for today",
    value: `${Math.round(left.kcal).toLocaleString()} kcal`,
    sub: `${Math.round(left.protein)} g protein · ${Math.round(left.carbs)} g carbs · ${Math.round(left.fat)} g fat`,
    accent: "fit",
    links: [{ label: "Open nutrition", href: "/nutrition" }],
  }
}
function workoutsAnswer(): Out {
  const s = fitStore.get()
  const weeks = sessionsByWeek(s, 8)
  const cur = weeks.at(-1)?.count ?? 0
  return {
    t: "answer",
    title: "Workouts this week",
    value: `${cur} of ${s.settings.weeklyTarget}`,
    accent: "fit",
    bars: {
      labels: weeks.map((_, i) =>
        i === weeks.length - 1 ? "now" : `-${weeks.length - 1 - i}w`,
      ),
      data: weeks.map((w) => w.count),
    },
    basis: "Last 8 weeks",
    links: [{ label: "Open fitness", href: "/fitness" }],
  }
}
function journalAnswer(q: string): Out {
  const st = captureStore.get()
  if (!st.settings.journalInQA)
    return {
      t: "info",
      tone: "advice",
      title: "Your journal is private from Q&A",
      body: "I don't read journal entries to answer questions unless you turn that on.",
      actions: [
        { label: "Open journal", do: "link", href: "/journal" },
        { label: "AI settings", do: "link", href: "/capture/settings" },
      ],
    }
  const words = q
    .toLowerCase()
    .replace(/\b(what|did|i|write|wrote|about|journal|my|in|the)\b/g, "")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
  const hits = st.journal.filter((j) =>
    words.some((w) => j.body.toLowerCase().includes(w)),
  )
  return {
    t: "answer",
    title: "From your journal",
    value: `${hits.length} entr${hits.length === 1 ? "y" : "ies"}`,
    accent: "life",
    list: hits.slice(0, 4).map((j) => ({
      label: j.body.slice(0, 48) + (j.body.length > 48 ? "…" : ""),
      value: j.day.slice(5),
      href: `/journal/${j.id}`,
    })),
    links: [{ label: "Open journal", href: "/journal" }],
  }
}
function adviceAnswer(q: string): Out {
  const amt = q.match(/(\d[\d,]*)(k)?/)
  const amount = amt
    ? Number(amt[1].replace(/,/g, "")) * (amt[2] ? 1000 : 1)
    : undefined
  const thing =
    q
      .match(
        /\bbuy (?:a |an |this |the )?([a-z ]{2,20}?)(?: on| for| with|\?|$)/i,
      )?.[1]
      ?.trim() ?? "this"
  const inst = /install?ment|0%|hulugan/.test(q)
  const s = finStore.get()
  const t = dayKey()
  const from = finAddDays(t, -90)
  let spend = 0
  let income = 0
  for (const r of s.records) {
    if (!isFlow(r) || recDay(r) < from) continue
    if (r.type === "expense") spend += r.amount
    else if (r.type === "income" && !r.isRefund) income += r.amount
  }
  const monthlyFree = Math.max(0, (income - spend) / 3)
  return {
    t: "info",
    tone: "advice",
    title: `Short answer: ${inst ? "0% installment is fine if the monthly fits" : "check how many months your savings cover first"}`,
    body: `You've kept about ${money(monthlyFree)} a month free over the last 90 days.${amount ? ` ${money(amount)}${inst ? ` over 12 months is ${money(amount / 12)}/mo` : ""}.` : ""} The Finance advisor can run it against your projection.`,
    actions: [
      {
        label: "Ask Finance advisor",
        do: "link",
        href: `/finance/advisor?ask=afford&name=${encodeURIComponent(thing)}${amount ? `&amount=${amount}` : ""}&mode=${inst ? "inst" : "lump"}&n=12`,
      },
    ],
  }
}
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())
export function answer(question: string): Out {
  const q = question.toLowerCase()
  if (/^(should i|can i afford|is it worth|worth it)\b/.test(q))
    return adviceAnswer(q)
  if (/\bjournal|wrote|write about\b/.test(q)) return journalAnswer(q)
  if (/\b(spend|spent|spending|gastos|magkano.*(gastos|nagastos))\b/.test(q))
    return spendAnswer(q)
  if (/\b(balance|net worth|how much (do i have|is in|money)|laman)\b/.test(q))
    return balanceAnswer(q)
  if (/\b(pr|personal record|max|1rm|heaviest|best)\b/.test(q))
    return prAnswer(q)
  if (/\b(weigh|weight|timbang)\b/.test(q)) return weightAnswer()
  if (/\bstreaks?\b/.test(q)) return streakAnswer()
  if (
    /\bhabits?\b/.test(q) &&
    /\b(left|remaining|pending|to do|still)\b/.test(q)
  )
    return habitsLeftAnswer()
  if (/\bhabits?\b/.test(q)) return habitsAnswer(q)
  if (/\b(protein|calories|kcal|macros?|carbs|fat)\b/.test(q))
    return macrosAnswer()
  if (/\b(workouts?|gym|sessions?|trained)\b/.test(q)) return workoutsAnswer()
  if (/\b(tasks?|due|to-?dos?|overdue|what do i have)\b/.test(q))
    return tasksAnswer(q)
  return {
    t: "info",
    tone: "fallback",
    title: "I can't answer that one yet",
    body: "In the prototype I can answer about spending, balances, PRs, weight, habits, streaks, tasks, macros and workouts.",
    actions: [
      {
        label: "Food spend this month",
        do: "prompt",
        prompt: "how much did I spend on food this month?",
      },
      { label: "Bench PR", do: "prompt", prompt: "what's my bench PR?" },
      {
        label: "Habits this week",
        do: "prompt",
        prompt: "how many habits did I do this week?",
      },
    ],
  }
}
export function budgetNote(categoryId?: string): string | undefined {
  if (!categoryId) return undefined
  const s = finStore.get()
  const cats = catMap(s)
  const parent = cats.get(categoryId)?.parentId
  const b = s.budgets.find(
    (x) =>
      !x.archived &&
      x.categoryIds &&
      (x.categoryIds.includes(categoryId) ||
        (parent && x.categoryIds.includes(parent))),
  )
  if (!b) return undefined
  const v = budgetView(s, b)
  const left = v.limit - v.spent
  return left >= 0
    ? `${money(left)} left in ${b.name} this month`
    : `Over ${b.name} budget by ${money(-left)}`
}
