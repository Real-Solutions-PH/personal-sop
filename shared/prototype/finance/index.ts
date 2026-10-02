"use client"
import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import {
  addDays,
  addMonths,
  budgetView,
  flowIn,
  isFlow,
  monthLabel,
  monthOf,
  monthRange,
  noSpendDays,
  occurrencesIn,
  project,
  recDay,
  savingsRate,
  today,
} from "./calc"
import type { FinState } from "./data"
import { useFin } from "./store"

export * as financeActions from "./actions"

const clamp = (v: number) => Math.max(0, Math.min(1, v))
function span(days: number, offset = 0): [string, string] {
  const to = addDays(today(), -offset * days)
  return [addDays(to, -(days - 1)), to]
}
function budgetScore(s: FinState) {
  const views = s.budgets
    .filter((b) => !b.archived)
    .map((b) => budgetView(s, b))
  if (!views.length) return 0.5
  return (
    views.filter((v) => v.pct <= Math.max(v.pace + 0.1, 0.1) && v.pct <= 1)
      .length / views.length
  )
}
function useAreaRate(days: number, offset = 0) {
  const s = useFin()
  return useMemo(() => {
    if (!s.accounts.length) return 0
    const to = addDays(today(), -offset)
    const sr = savingsRate(
      flowIn(s, addDays(to, -(Math.max(days, 30) - 1)), to),
    )
    return (
      Math.round((0.6 * clamp(sr / 0.3) + 0.4 * budgetScore(s)) * 100) / 100
    )
  }, [s, days, offset])
}
function runwayMonths(s: FinState) {
  const p = project(s, { horizon: 1, includeUnplanned: false })
  const mk = monthOf(today(), 1)
  let spend = 0
  for (let i = 1; i <= 3; i++) {
    const [f, t] = monthRange(addMonths(mk, -i), 1)
    spend += flowIn(s, f, t).spend
  }
  return spend ? p.start / (spend / 3) : 0
}
function useMetrics(days: number): Metric[] {
  const s = useFin()
  return useMemo(() => {
    if (!s.accounts.length) return []
    const [from, to] = span(days)
    const [pf, pt] = span(days, 1)
    const cur = flowIn(s, from, to)
    const prev = flowIn(s, pf, pt)
    const sr = savingsRate(cur)
    const psr = savingsRate(prev)
    const ns = noSpendDays(s, from, to)
    const pns = noSpendDays(s, pf, pt)
    const views = s.budgets
      .filter((b) => !b.archived)
      .map((b) => budgetView(s, b))
    const kept = views.filter((v) => v.pct <= 1).length
    const runway = runwayMonths(s)
    const spendVs = prev.spend ? cur.spend / prev.spend - 1 : 0
    return [
      {
        key: "savings-rate",
        label: "Savings rate",
        value: `${Math.round(sr * 100)}%`,
        delta: Math.round((sr - psr) * 100),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "no-spend",
        label: "No-spend days",
        value: `${ns.count}${ns.streak >= 2 ? ` · ${ns.streak}-day streak` : ""}`,
        delta: ns.count - pns.count,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "budgets",
        label: "Budgets on track",
        value: `${kept}/${views.length}`,
        shareable: true,
      },
      {
        key: "runway",
        label: "Months you could cover",
        value: `${runway.toFixed(1)} mo`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "spend-vs",
        label: "Spending vs last period",
        value: `${spendVs >= 0 ? "+" : ""}${Math.round(spendVs * 100)}%`,
        delta: Math.round(spendVs * 100),
        goodWhen: "down",
        shareable: true,
      },
    ]
  }, [s, days])
}
function useCalendar(from: string, to: string): CalendarItem[] {
  const s = useFin()
  return useMemo(
    () =>
      occurrencesIn(s, from, to)
        .filter((o) => o.status !== "skipped")
        .map((o) => ({
          id: `fin-${o.item.id}-${o.orig}`,
          day: o.day,
          title: `${o.item.type === "income" ? "Payday" : o.item.type === "transfer" ? "Transfer" : "Bill"} · ${o.item.name}`,
          module: "finance" as const,
          done: o.status === "paid",
          href: `/finance/planned/${o.item.id}`,
        })),
    [s, from, to],
  )
}
function useMisses(from: string, to: string): Miss[] {
  const s = useFin()
  return useMemo(() => {
    const out: Miss[] = []
    const sd = s.settings.monthStartDay
    const t = today()
    let mk = monthOf(from, sd)
    const last = monthOf(to, sd)
    for (
      let guard = 0;
      mk <= last && guard < 24;
      guard++, mk = addMonths(mk, 1)
    ) {
      const [, mt] = monthRange(mk, sd)
      for (const b of s.budgets.filter((x) => !x.archived)) {
        const v = budgetView(s, b, mk)
        if (v.pct > 1)
          out.push({
            id: `fin-budget-${b.id}-${mk}`,
            day: mt < t ? mt : t,
            title: `Over ${b.name} budget by ${Math.round((v.pct - 1) * 100)}% (${monthLabel(mk)})`,
            module: "finance",
            href: `/finance/budgets/${b.id}`,
          })
      }
    }
    for (const o of occurrencesIn(s, from, to < t ? to : addDays(t, -1)))
      if (o.status === "overdue")
        out.push({
          id: `fin-due-${o.item.id}-${o.orig}`,
          day: o.day,
          title: `Unpaid: ${o.item.name}`,
          module: "finance",
          href: `/finance/planned/${o.item.id}`,
        })
    for (const r of s.records) {
      const k = recDay(r)
      if (
        k < from ||
        k > to ||
        !isFlow(r) ||
        r.type !== "expense" ||
        r.plannedId ||
        r.amount < 5000
      )
        continue
      out.push({
        id: `fin-big-${r.id}`,
        day: k,
        title: `Unplanned big purchase: ${r.payee ?? "expense"}`,
        module: "finance",
        href: `/finance/records/${r.id}`,
      })
    }
    return out.sort((a, b) => b.day.localeCompare(a.day))
  }, [s, from, to])
}
function useTodayProgress() {
  const s = useFin()
  const due = useMemo(() => {
    const t = today()
    const occ = occurrencesIn(s, addDays(t, -14), t).filter(
      (o) => !o.item.autoLog && (o.day === t || o.status === "overdue"),
    )
    return occ
  }, [s])
  const dueN = due.length
  const done = due.filter((o) => o.status === "paid").length
  return useMemo(() => ({ due: dueN, done }), [dueN, done])
}
export const module: ModuleContract = {
  key: "finance",
  label: "Finance",
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/finance",
}
