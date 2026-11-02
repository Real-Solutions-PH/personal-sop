// What a money record does to the month's budgets and savings goals, found
// by comparing the finance state before and after it: a budget it pushes
// over (or further over), a budget it puts ahead of pace, a savings goal it
// reaches. The record editor warns with the first two and cheers the last.

import * as C from "@domain/finance/calc"
import type { FinRecord, FinState } from "@domain/finance/data"

/** The same margin the budget cards use before calling a budget ahead. */
const AHEAD = 0.05

export type BudgetHit =
  | { id: string; name: string; kind: "over"; over: number; was: boolean }
  | {
      id: string
      name: string
      kind: "pace"
      spent: number
      limit: number
      daysLeft: number
    }

const ahead = (v: C.BudgetView) => v.pct <= 1 && v.pct > v.pace + AHEAD

/** Budgets in ``day``'s budget month that ``after`` leaves worse than
 * ``before``: over the limit (``was``: already over before), or newly
 * ahead of pace. Budgets the change did not grow are left out. */
export function budgetHits(
  before: FinState,
  after: FinState,
  day: string,
): BudgetHit[] {
  const mk = C.monthOf(day, after.settings.monthStartDay)
  const out: BudgetHit[] = []
  for (const b of after.budgets) {
    if (b.archived) continue
    const was = before.budgets.find((x) => x.id === b.id) ?? b
    const v0 = C.budgetView(before, was, mk)
    const v1 = C.budgetView(after, b, mk)
    if (v1.spent <= v0.spent) continue
    if (v1.spent > v1.limit)
      out.push({
        id: b.id,
        name: b.name,
        kind: "over",
        over: v1.spent - v1.limit,
        was: v0.spent > v0.limit,
      })
    else if (ahead(v1) && !ahead(v0))
      out.push({
        id: b.id,
        name: b.name,
        kind: "pace",
        spent: v1.spent,
        limit: v1.limit,
        daysLeft: v1.daysLeft,
      })
  }
  // The worst first: over before ahead, the most over first.
  return out.sort(
    (a, b) =>
      (a.kind === "over" ? 0 : 1) - (b.kind === "over" ? 0 : 1) ||
      (b.kind === "over" ? b.over : 0) - (a.kind === "over" ? a.over : 0),
  )
}

/** Savings goals ``after`` reaches that ``before`` had not. */
export function goalsReached(before: FinState, after: FinState) {
  const b0 = C.balances(before)
  const b1 = C.balances(after)
  return after.accounts.filter(
    (a) =>
      !a.archived &&
      !!a.goal &&
      (b0[a.id] ?? a.opening) < a.goal &&
      (b1[a.id] ?? a.opening) >= a.goal,
  )
}

/** ``s`` as it would be with ``draft`` saved (replacing ``replaces``). */
export function withDraft(
  s: FinState,
  draft: FinRecord,
  replaces?: string,
): FinState {
  return {
    ...s,
    records: [...s.records.filter((r) => r.id !== replaces), draft],
  }
}

/** One line for a hit: "Food budget now over by ₱420" once saved, and
 * "Saving this puts Food budget over by ₱420" before. */
export function hitLine(
  h: BudgetHit,
  money: (n: number) => string,
  saved = true,
) {
  const name = /budget$/i.test(h.name) ? h.name : `${h.name} budget`
  if (h.kind === "over")
    return saved
      ? `${name} now over by ${money(h.over)}`
      : `Saving this puts ${name} over by ${money(h.over)}`
  const left =
    h.daysLeft > 0
      ? ` with ${h.daysLeft} day${h.daysLeft === 1 ? "" : "s"} left`
      : ""
  return `${saved ? `${name} now` : `Saving this puts ${name}`} ahead of pace: ${money(h.spent)} of ${money(h.limit)}${left}`
}
