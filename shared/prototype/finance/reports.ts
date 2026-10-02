import {
  addDays,
  addMonths,
  budgetView,
  catMap,
  diffDays,
  flowIn,
  isFlow,
  monthLabel,
  monthOf,
  monthRange,
  netWorthSeries,
  recDay,
  today,
} from "./calc"
import type { FinState } from "./data"
export type Period = "this" | "last" | "3m"
export function periodRange(
  s: FinState,
  p: Period,
): {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  label: string
} {
  const sd = s.settings.monthStartDay
  const mk = monthOf(today(), sd)
  if (p === "3m") {
    const [from] = monthRange(addMonths(mk, -2), sd)
    const to = today()
    const len = diffDays(to, from) + 1
    return {
      from,
      to,
      prevFrom: addDays(from, -len),
      prevTo: addDays(from, -1),
      label: "Last 3 months",
    }
  }
  const m = p === "this" ? mk : addMonths(mk, -1)
  const [from, to] = monthRange(m, sd)
  const [pf, pt] = monthRange(addMonths(m, -1), sd)
  return {
    from,
    to: to > today() ? today() : to,
    prevFrom: pf,
    prevTo: pt,
    label: monthLabel(m, true),
  }
}
export function reportData(s: FinState, p: Period) {
  const r = periodRange(s, p)
  const flow = flowIn(s, r.from, r.to)
  const prev = flowIn(s, r.prevFrom, r.prevTo)
  const cats = catMap(s)
  const byCat = [...flow.byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const payees = [...flow.byPayee.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
  const days = diffDays(r.to, r.from) + 1
  const daily: number[] = []
  const byDay = new Map<string, number>()
  const weekday = [0, 0, 0, 0, 0, 0, 0]
  const weekdayN = [0, 0, 0, 0, 0, 0, 0]
  for (const x of s.records) {
    if (!isFlow(x)) continue
    const k = recDay(x)
    if (k < r.from || k > r.to) continue
    const v =
      x.type === "income" && !x.isRefund
        ? x.amount
        : x.type === "expense"
          ? -x.amount
          : x.amount
    byDay.set(k, (byDay.get(k) ?? 0) + v)
    if (x.type === "expense")
      weekday[new Date(`${k}T12:00:00`).getDay()] += x.amount
  }
  let cum = 0
  for (let i = 0; i < days; i++) {
    const k = addDays(r.from, i)
    weekdayN[new Date(`${k}T12:00:00`).getDay()]++
    cum += byDay.get(k) ?? 0
    daily.push(cum)
  }
  const sd = s.settings.monthStartDay
  const mk = monthOf(today(), sd)
  const months = [-3, -2, -1, 0].map((i) => {
    const [f, t] = monthRange(addMonths(mk, i), sd)
    const fl = flowIn(s, f, t)
    return { key: addMonths(mk, i), income: fl.income, spend: fl.spend }
  })
  const budgets = s.budgets
    .filter((b) => !b.archived)
    .map((b) => ({
      b,
      hist: [-2, -1, 0].map((i) => budgetView(s, b, addMonths(mk, i))),
    }))
  return {
    r,
    flow,
    prev,
    cats,
    byCat,
    payees,
    daily,
    days,
    weekdayAvg: weekday.map((v, i) => (weekdayN[i] ? v / weekdayN[i] : 0)),
    months,
    budgets,
    nw: netWorthSeries(s, 90),
  }
}
