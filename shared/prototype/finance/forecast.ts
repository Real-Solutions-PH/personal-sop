// Date-driven reads for Finance: the money on hand day by day over a picked
// future range, net worth against what the repeating items alone predict,
// and the limits a picked range must respect.
import {
  addDays,
  avgUnplanned,
  diffDays,
  type Occurrence,
  occurrences,
  occurrencesIn,
  parseKey,
  recDay,
  today,
} from "./calc"
import { type FinState, type PlannedItem, signedFor } from "./data"

export interface DateRange {
  from: string
  to: string
}

const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
/** "1 Aug", or "1 Aug 2026" with the year. */
export function dayMonth(k: string, year = false) {
  const d = parseKey(k)
  return `${d.getDate()} ${MON[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ""}`
}
/** "1 Aug – 30 Oct 2026". */
export const rangeLabel = (r: DateRange) =>
  `${dayMonth(r.from)} – ${dayMonth(r.to, true)}`

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
/** A real calendar day written as YYYY-MM-DD. */
export function isDayKey(k: unknown): k is string {
  if (typeof k !== "string" || !DAY_KEY.test(k)) return false
  const d = parseKey(k)
  return (
    !Number.isNaN(d.getTime()) &&
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` ===
      k
  )
}

/** Furthest a forecast looks ahead, in days from today. */
export const MAX_AHEAD_DAYS = 730
/** Longest look-back window a report takes. */
export const MAX_REPORT_DAYS = 400

/** Why a forecast range cannot be shown, or null when it can. */
export function aheadRangeError(r: DateRange): string | null {
  const t = today()
  if (r.to < r.from) return "Pick an end date after the start date"
  if (r.from < t) return "Pick a start date from today on"
  if (r.to > addDays(t, MAX_AHEAD_DAYS)) return "Pick a date within 24 months"
  return null
}
/** Why a report range cannot be shown, or null when it can. */
export function backRangeError(r: DateRange): string | null {
  if (r.to < r.from) return "Pick an end date after the start date"
  if (r.to > today()) return "Pick an end date of today or earlier"
  if (diffDays(r.to, r.from) + 1 > MAX_REPORT_DAYS)
    return "Pick a range of up to 400 days"
  return null
}

/** What one scheduled item does to a set of accounts: income in, bills
 * out, transfers only when they cross the edge of the set. */
function effectOn(p: PlannedItem, ids: Set<string>): number {
  if (p.type === "income") return ids.has(p.accountId) ? p.amount : 0
  if (p.type === "expense") return ids.has(p.accountId) ? -p.amount : 0
  const out = ids.has(p.accountId)
  const into = !!p.toAccountId && ids.has(p.toAccountId)
  if (out && !into) return -p.amount
  if (!out && into) return p.amount
  return 0
}

export interface ForecastDay {
  day: string
  balance: number
  income: number
  bills: number
  everyday: number
}
export interface Forecast {
  from: string
  to: string
  /** Money on hand today, in the accounts counted in the projection. */
  start: number
  /** Expected money on hand at the end of ``from``. */
  atFrom: number
  /** Expected money on hand at the end of ``to``. */
  atTo: number
  /** Scheduled income inside the range. */
  income: number
  /** Scheduled money out inside the range. */
  bills: number
  /** Everyday spending inside the range (0 when it is left out). */
  everyday: number
  net: number
  /** Lowest balance inside the range. */
  low: { day: string; value: number }
  /** One per day from today to ``to``. */
  days: ForecastDay[]
  /** Unpaid, unskipped occurrences inside the range. */
  items: Occurrence[]
  hasIncome: boolean
}

/**
 * Money on hand day by day from today to ``to``, and what happens inside
 * ``from``–``to``. Follows ``project()``: the accounts and planned items
 * counted in the projection, paid and skipped occurrences dropped, transfers
 * counted only across the edge of the counted accounts. Overdue unpaid items
 * land on today. Everyday spending, when included, is the 3-month average
 * spread evenly by day from tomorrow on.
 */
export function forecast(
  s: FinState,
  from: string,
  to: string,
  opts: {
    includeUnplanned: boolean
    excludedPlanned?: string[]
    excludedAccounts?: string[]
  },
): Forecast {
  const t = today()
  const excl = opts.excludedAccounts ?? []
  const ids = new Set(
    s.accounts
      .filter((a) => a.inProjection && !a.archived && !excl.includes(a.id))
      .map((a) => a.id),
  )
  let start = 0
  for (const a of s.accounts) {
    if (!ids.has(a.id)) continue
    start += a.opening
    for (const r of s.records) start += signedFor(r, a.id)
  }
  const counted = (p: PlannedItem) =>
    p.inProjection && !(opts.excludedPlanned ?? []).includes(p.id)
  const all = occurrencesIn(s, addDays(t, -60), to).filter(
    (o) => o.status !== "paid" && o.status !== "skipped" && counted(o.item),
  )
  const moves = new Map<string, { income: number; bills: number }>()
  let hasIncome = false
  for (const o of all) {
    const d = effectOn(o.item, ids)
    if (!d) continue
    if (d > 0 && o.item.type === "income") hasIncome = true
    const day = o.day < t ? t : o.day
    const m = moves.get(day) ?? { income: 0, bills: 0 }
    if (d > 0) m.income += d
    else m.bills -= d
    moves.set(day, m)
  }
  const perDay = opts.includeUnplanned ? (avgUnplanned(s) * 12) / 365 : 0
  const days: ForecastDay[] = []
  let run = start
  let atFrom = start
  let income = 0
  let bills = 0
  let everyday = 0
  let low: Forecast["low"] | null = null
  for (let k = t; k <= to; k = addDays(k, 1)) {
    const m = moves.get(k) ?? { income: 0, bills: 0 }
    const e = k > t ? perDay : 0
    run += m.income - m.bills - e
    days.push({
      day: k,
      balance: run,
      income: m.income,
      bills: m.bills,
      everyday: e,
    })
    if (k === from) atFrom = run
    if (k >= from) {
      income += m.income
      bills += m.bills
      everyday += e
      if (!low || run < low.value) low = { day: k, value: run }
    }
  }
  return {
    from,
    to,
    start,
    atFrom,
    atTo: run,
    income,
    bills,
    everyday,
    net: income - bills - everyday,
    low: low ?? { day: from, value: run },
    days,
    items: all.filter((o) => {
      const day = o.day < t ? t : o.day
      return day >= from && day <= to
    }),
    hasIncome,
  }
}

export interface ExpectedTrend {
  /** Every day from ``from`` to ``to``. */
  days: string[]
  /** Net worth at the end of each day, up to today. */
  actual: number[]
  /** One per day: the starting net worth plus what repeats. */
  expected: number[]
  hasRecurring: boolean
  /** Actual minus expected today, or null when today is outside the range. */
  gapToday: number | null
}

/**
 * Net worth over ``from``–``to`` against the line the repeating income and
 * bills alone draw from the same start. Each repeating occurrence counts on
 * its day, logged or not; skipped ones count as nothing. One-off items and
 * what-ifs are left out, so they show up as the gap between the lines.
 */
export function expectedTrend(
  s: FinState,
  from: string,
  to: string,
): ExpectedTrend {
  const t = today()
  const nw = s.accounts.filter((a) => a.inNetWorth && !a.archived)
  const ids = new Set(nw.map((a) => a.id))
  let base = nw.reduce((sum, a) => sum + a.opening, 0)
  const byDay = new Map<string, number>()
  for (const r of s.records) {
    let d = 0
    for (const a of nw) d += signedFor(r, a.id)
    if (!d) continue
    const k = recDay(r)
    if (k < from) base += d
    else byDay.set(k, (byDay.get(k) ?? 0) + d)
  }
  const recurring = s.planned.filter(
    (p) => !p.archived && !p.isWhatIf && p.schedule.kind !== "once",
  )
  const delta = new Map<string, number>()
  for (const p of recurring) {
    const d = effectOn(p, ids)
    if (!d) continue
    for (const k of occurrences(p, from, to))
      if (!p.skipped.includes(k)) delta.set(k, (delta.get(k) ?? 0) + d)
  }
  const days: string[] = []
  const actual: number[] = []
  const expected: number[] = []
  let a = base
  let gapToday: number | null = null
  for (let k = from; k <= to; k = addDays(k, 1)) {
    days.push(k)
    a += byDay.get(k) ?? 0
    if (k <= t) actual.push(a)
    // The first day starts from that day's actual net worth.
    const prev = expected.length ? expected[expected.length - 1] : a
    const e = prev + (delta.get(k) ?? 0)
    expected.push(e)
    if (k === t) gapToday = a - e
  }
  return {
    days,
    actual,
    expected,
    hasRecurring: recurring.length > 0,
    gapToday,
  }
}
