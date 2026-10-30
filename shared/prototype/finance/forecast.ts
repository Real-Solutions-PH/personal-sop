// Date-driven reads for the Finance home, reports and projection: the money
// on hand day by day up to a chosen date, the preset windows the range
// pickers offer, and actual net worth against what the repeating items
// alone would have made it.
import {
  addDays,
  addMonths,
  avgUnplanned,
  diffDays,
  lastDom,
  monthOf,
  monthRange,
  type Occurrence,
  occurrences,
  occurrencesIn,
  parseKey,
  recDay,
  today,
  type WhatIf,
} from "./calc"
import { type FinState, type PlannedItem, signedFor } from "./data"

export interface DateRange {
  from: string
  to: string
}

/** The same day ``n`` months on, kept inside the target month. */
export function addMonthsToDay(k: string, n: number): string {
  const d = parseKey(k)
  const y = d.getFullYear()
  const m0 = d.getMonth() + n
  const ty = y + Math.floor(m0 / 12)
  const tm = ((m0 % 12) + 12) % 12
  const day = Math.min(d.getDate(), lastDom(ty, tm))
  return `${ty}-${String(tm + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

export type AheadPreset = "month" | "3m" | "6m" | "1y" | "2y"
export const AHEAD_PRESETS: { value: AheadPreset; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "3m", label: "3 mo" },
  { value: "6m", label: "6 mo" },
  { value: "1y", label: "1 yr" },
  { value: "2y", label: "2 yr" },
]
/** The last day a forward-looking preset covers, from today. "This month"
 * runs to the end of the budget month. */
export function aheadEnd(s: FinState, p: AheadPreset): string {
  const t = today()
  if (p === "month")
    return monthRange(
      monthOf(t, s.settings.monthStartDay),
      s.settings.monthStartDay,
    )[1]
  const n = { "3m": 3, "6m": 6, "1y": 12, "2y": 24 }[p]
  return addMonthsToDay(t, n)
}

export type BackPreset = "this" | "last" | "3m" | "6m" | "1y"
export const BACK_PRESETS: { value: BackPreset; label: string }[] = [
  { value: "this", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "3m", label: "3 mo" },
  { value: "6m", label: "6 mo" },
  { value: "1y", label: "1 yr" },
]
/** A look-back preset as dates. Month presets follow the budget month and
 * stop at today; "3 mo" and longer start on the first day of the budget
 * month that many months back. */
export function backRange(s: FinState, p: BackPreset): DateRange {
  const sd = s.settings.monthStartDay
  const t = today()
  const mk = monthOf(t, sd)
  if (p === "last") {
    const [from, to] = monthRange(addMonths(mk, -1), sd)
    return { from, to }
  }
  const back = { this: 0, "3m": 2, "6m": 5, "1y": 11 }[p]
  const [from] = monthRange(addMonths(mk, -back), sd)
  return { from, to: t }
}

export interface DayForecast {
  /** Money on hand today, in the accounts counted in the projection. */
  start: number
  /** Expected money on hand at the end of each day, today first. */
  days: { day: string; balance: number }[]
  /** Scheduled items still to happen up to the date, overdue first. Items
   * left out of the projection are listed but move nothing. */
  items: Occurrence[]
  comingIn: number
  scheduledOut: number
  /** Everyday spending spread by day, from tomorrow on: the 3-month
   * average of what was not scheduled. Zero when that setting is off. */
  everydayOut: number
  end: number
  low: { day: string; value: number }
}

/**
 * Money on hand day by day from today to ``to``. Scheduled income and
 * bills land on their day (overdue ones today); what-if purchases land on
 * the 15th of their month, split evenly over their installments; everyday
 * spending, when included, comes off a little every day. Follows the
 * projection's settings unless overridden.
 */
export function dailyForecast(
  s: FinState,
  to: string,
  opts: {
    includeUnplanned?: boolean
    excludedPlanned?: string[]
    excludedAccounts?: string[]
    whatIf?: WhatIf | null
  } = {},
): DayForecast {
  const t = today()
  const end = to < t ? t : to
  const includeUnplanned = opts.includeUnplanned ?? s.settings.includeUnplanned
  const excludedPlanned = opts.excludedPlanned ?? s.settings.projExcludedPlanned
  const excl = opts.excludedAccounts ?? []
  const liquidIds = new Set(
    s.accounts
      .filter((a) => a.inProjection && !a.archived && !excl.includes(a.id))
      .map((a) => a.id),
  )
  let start = 0
  for (const a of s.accounts) {
    if (!liquidIds.has(a.id)) continue
    start += a.opening
    for (const r of s.records) start += signedFor(r, a.id)
  }
  const items = occurrencesIn(s, addDays(t, -60), end).filter(
    (o) => o.status !== "paid" && o.status !== "skipped",
  )
  const moves = new Map<string, number>()
  const move = (day: string, v: number) =>
    moves.set(day, (moves.get(day) ?? 0) + v)
  let comingIn = 0
  let scheduledOut = 0
  for (const o of items) {
    const p = o.item
    if (!p.inProjection || excludedPlanned.includes(p.id)) continue
    const d = liquidEffect(p, liquidIds)
    if (!d) continue
    if (d > 0) comingIn += d
    else scheduledOut -= d
    move(o.day < t ? t : o.day, d)
  }
  const w = opts.whatIf
  if (w && w.amount > 0) {
    const n = Math.max(1, w.installments)
    for (let i = 0; i < n; i++) {
      const day = `${addMonths(w.month, i)}-15`
      if (day < t || day > end) continue
      scheduledOut += w.amount / n
      move(day, -w.amount / n)
    }
  }
  const perDay = includeUnplanned ? (avgUnplanned(s) * 12) / 365 : 0
  const days: DayForecast["days"] = []
  let run = start
  let everydayOut = 0
  let low = { day: t, value: start }
  for (let k = t; k <= end; k = addDays(k, 1)) {
    run += moves.get(k) ?? 0
    if (k > t) {
      run -= perDay
      everydayOut += perDay
    }
    days.push({ day: k, balance: run })
    if (run < low.value) low = { day: k, value: run }
  }
  return {
    start,
    days,
    items,
    comingIn,
    scheduledOut,
    everydayOut,
    end: run,
    low,
  }
}

/** What one scheduled item does to the money on hand: income in, bills
 * out, transfers only when they cross the edge of the counted accounts. */
function liquidEffect(p: PlannedItem, liquidIds: Set<string>): number {
  if (p.type === "income") return liquidIds.has(p.accountId) ? p.amount : 0
  if (p.type === "expense") return liquidIds.has(p.accountId) ? -p.amount : 0
  const fromLiquid = liquidIds.has(p.accountId)
  const toLiquid = !!p.toAccountId && liquidIds.has(p.toAccountId)
  if (fromLiquid && !toLiquid) return -p.amount
  if (!fromLiquid && toLiquid) return p.amount
  return 0
}

export interface ExpectedVsActual {
  days: string[]
  /** Net worth at the end of each day, from the records. */
  actual: number[]
  /** Net worth had only the repeating items happened, on their days,
   * from the same starting point. */
  expected: number[]
  /** Actual minus expected on the last day. */
  gap: number
}

/**
 * Net worth over ``from``–``to`` (stopping at today) against the line the
 * repeating income and bills alone draw from the same start. Each
 * repeating item counts on its scheduled day whether it was logged or not;
 * one-off items and what-ifs are left out.
 */
export function expectedVsActual(
  s: FinState,
  from: string,
  to: string,
): ExpectedVsActual {
  const t = today()
  const end = to > t ? t : to
  const inc = s.accounts.filter((a) => a.inNetWorth && !a.archived)
  const nwIds = new Set(inc.map((a) => a.id))
  let base = inc.reduce((sum, a) => sum + a.opening, 0)
  const byDay = new Map<string, number>()
  for (const r of s.records) {
    let d = 0
    for (const a of inc) d += signedFor(r, a.id)
    if (!d) continue
    const k = recDay(r)
    if (k < from) base += d
    else byDay.set(k, (byDay.get(k) ?? 0) + d)
  }
  const planned = new Map<string, number>()
  for (const p of s.planned) {
    if (p.archived || p.isWhatIf || p.schedule.kind === "once") continue
    const d = liquidEffect(p, nwIds)
    if (!d) continue
    for (const k of occurrences(p, from, end))
      planned.set(k, (planned.get(k) ?? 0) + d)
  }
  const days: string[] = []
  const actual: number[] = []
  const expected: number[] = []
  let a = base
  let e = base
  for (let k = from; k <= end; k = addDays(k, 1)) {
    a += byDay.get(k) ?? 0
    e += planned.get(k) ?? 0
    days.push(k)
    actual.push(a)
    expected.push(e)
  }
  return {
    days,
    actual,
    expected,
    gap: actual.length ? a - e : 0,
  }
}

/** Day count of a range, both ends included. */
export const rangeDays = (r: DateRange) => diffDays(r.to, r.from) + 1

/** Money on hand at the end of each day over ``from``–``to`` (stopping at
 * today), from the records, in the accounts counted in the projection. */
export function liquidSeries(s: FinState, from: string, to: string): number[] {
  const t = today()
  const end = to > t ? t : to
  const ids = s.accounts
    .filter((a) => a.inProjection && !a.archived)
    .map((a) => a.id)
  let run = s.accounts
    .filter((a) => ids.includes(a.id))
    .reduce((sum, a) => sum + a.opening, 0)
  const byDay = new Map<string, number>()
  for (const r of s.records) {
    let d = 0
    for (const id of ids) d += signedFor(r, id)
    if (!d) continue
    const k = recDay(r)
    if (k < from) run += d
    else byDay.set(k, (byDay.get(k) ?? 0) + d)
  }
  const out: number[] = []
  for (let k = from; k <= end; k = addDays(k, 1)) {
    run += byDay.get(k) ?? 0
    out.push(run)
  }
  return out
}
