import {
  addDays,
  budgetView,
  catMap,
  diffDays,
  flowIn,
  monthOf,
  monthRange,
  noSpendDays,
  recDay,
  savingsRate,
} from "./calc"
import type { FinState } from "./data"
export function lookback(
  s: FinState,
  from: string,
  to: string,
  prevFrom: string,
  prevTo: string,
) {
  const cats = catMap(s)
  const flow = flowIn(s, from, to)
  const prev = flowIn(s, prevFrom, prevTo)
  // trailing 3-period average spend
  const len = diffDays(to, from) + 1
  let base = 0
  for (let i = 1; i <= 3; i++)
    base += flowIn(
      s,
      addDays(from, -len * i),
      addDays(from, -len * (i - 1) - 1),
    ).spend
  base /= 3
  const rate = savingsRate(flow)
  const prevRate = savingsRate(prev)
  const ns = noSpendDays(s, from, to)
  const sd = s.settings.monthStartDay
  const mk = monthOf(from, sd)
  const isMonth = monthRange(mk, sd)[0] === from
  const budgets = s.budgets
    .filter((b) => !b.archived)
    .map((b) => (isMonth ? budgetView(s, b, mk) : null))
    .filter((x) => x !== null)
  const kept = budgets.filter((v) => v.pct <= 1)
  const blown = budgets.filter((v) => v.pct > 1)
  const where = [...flow.byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({
      id,
      v,
      prev: prev.byCat.get(id) ?? 0,
      cat: cats.get(id),
    }))
  const spikes = where.filter((w) => w.prev > 500 && w.v > w.prev * 1.25)
  const inRange = s.records.filter((r) => {
    const k = recDay(r)
    return k >= from && k <= to
  })
  const big = inRange.filter(
    (r) => r.type === "expense" && !r.plannedId && r.amount >= 5000,
  )
  // leaks: frequent small discretionary spends by payee
  const byPayee = new Map<string, { n: number; v: number; cat?: string }>()
  for (const r of inRange) {
    if (r.type !== "expense" || !r.payee || r.amount > 1000) continue
    if (!cats.get(r.categoryId ?? "")?.discretionary) continue
    const cur = byPayee.get(r.payee) ?? { n: 0, v: 0, cat: r.categoryId }
    byPayee.set(r.payee, { n: cur.n + 1, v: cur.v + r.amount, cat: cur.cat })
  }
  const leaks = [...byPayee.entries()]
    .filter(([, x]) => x.n >= 4)
    .sort((a, b) => b[1].v - a[1].v)
    .slice(0, 4)
  const subs = inRange
    .filter((r) => r.categoryId === "subs")
    .reduce((x, r) => x + r.amount, 0)
  const imported = inRange.filter((r) => r.source === "import").length
  const completeness = inRange.length ? 1 - imported / inRange.length : 1
  const topShare = where[0] ? where[0].v / Math.max(1, flow.spend) : 0
  return {
    flow,
    prev,
    base,
    rate,
    prevRate,
    ns,
    budgets,
    kept,
    blown,
    where,
    spikes,
    big,
    leaks,
    subs,
    completeness,
    topShare,
    cats,
    len,
  }
}
