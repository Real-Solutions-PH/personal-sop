import { dayKey } from "../lib/day"
import { moneyCompact } from "../lib/money"
import {
  type Account,
  type Budget,
  type Category,
  type FinRecord,
  type FinState,
  type ImportRow,
  type PlannedItem,
  RAW_HINTS,
  type StatementRow,
  signedFor,
} from "./data"

const pad = (n: number) => String(n).padStart(2, "0")
export const keyOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const parseKey = (k: string) => new Date(`${k}T12:00:00`)
export const addDays = (k: string, n: number) => {
  const d = parseKey(k)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}
export const diffDays = (a: string, b: string) =>
  Math.round((parseKey(a).getTime() - parseKey(b).getTime()) / 86400000)
export const recDay = (r: FinRecord) => dayKey(new Date(r.at))
export const today = () => dayKey()
const MONTHS = [
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
const LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]
export const monthLabel = (mk: string, long = false) => {
  const [y, mo] = mk.split("-").map(Number)
  return `${(long ? LONG : MONTHS)[mo - 1]}${long ? ` ${y}` : ""}`
}
export const dayLabel = (k: string) => {
  const t = today()
  if (k === t) return "Today"
  if (k === addDays(t, -1)) return "Yesterday"
  if (k === addDays(t, 1)) return "Tomorrow"
  const d = parseKey(k)
  return d.toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
export const shortDate = (k: string) =>
  parseKey(k).toLocaleDateString("en-PH", { month: "short", day: "numeric" })
export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })
export function monthOf(k: string, startDay = 1): string {
  const d = parseKey(k)
  if (d.getDate() < startDay) d.setMonth(d.getMonth() - 1, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
export function addMonths(mk: string, n: number): string {
  const [y, m] = mk.split("-").map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}
export function monthRange(mk: string, startDay = 1): [string, string] {
  const [y, m] = mk.split("-").map(Number)
  const from = new Date(y, m - 1, startDay, 12)
  const to = new Date(y, m, startDay - 1, 12)
  return [keyOf(from), keyOf(to)]
}
export const lastDom = (y: number, m0: number) =>
  new Date(y, m0 + 1, 0).getDate()
export function catMap(s: FinState) {
  return new Map(s.categories.map((c) => [c.id, c]))
}
export function acctMap(s: FinState) {
  return new Map(s.accounts.map((a) => [a.id, a]))
}
export function inScope(
  catId: string | undefined,
  ids: string[] | null,
  cats: Map<string, Category>,
) {
  if (!ids) return true
  if (!catId) return false
  if (ids.includes(catId)) return true
  const parent = cats.get(catId)?.parentId
  return !!parent && ids.includes(parent)
}
export const topCat = (id: string | undefined, cats: Map<string, Category>) => {
  const c = id ? cats.get(id) : undefined
  return c?.parentId ? (cats.get(c.parentId) ?? c) : c
}
export function balanceOf(s: FinState, acct: Account, asOf?: string): number {
  let b = acct.opening
  for (const r of s.records) {
    if (asOf && recDay(r) > asOf) continue
    b += signedFor(r, acct.id)
  }
  return b
}
export function balances(s: FinState): Record<string, number> {
  const out: Record<string, number> = {}
  for (const a of s.accounts) out[a.id] = a.opening
  for (const r of s.records) {
    if (r.type === "transfer") {
      if (out[r.accountId] !== undefined) out[r.accountId] -= r.amount
      if (r.toAccountId && out[r.toAccountId] !== undefined)
        out[r.toAccountId] += r.amount
    } else if (out[r.accountId] !== undefined) {
      out[r.accountId] += r.type === "income" ? r.amount : -r.amount
    }
  }
  return out
}
export function netWorth(s: FinState, bal = balances(s)) {
  return s.accounts
    .filter((a) => a.inNetWorth && !a.archived)
    .reduce((sum, a) => sum + bal[a.id], 0)
}
export function liquid(s: FinState, bal = balances(s), exclude: string[] = []) {
  return s.accounts
    .filter((a) => a.inProjection && !a.archived && !exclude.includes(a.id))
    .reduce((sum, a) => sum + bal[a.id], 0)
}
export function netWorthSeries(s: FinState, days = 90): number[] {
  const t = today()
  const inc = s.accounts.filter((a) => a.inNetWorth && !a.archived)
  let nw = inc.reduce((sum, a) => sum + a.opening, 0)
  const byDay = new Map<string, number>()
  for (const r of s.records) {
    let d = 0
    for (const a of inc) d += signedFor(r, a.id)
    if (!d) continue
    const k = recDay(r)
    byDay.set(k, (byDay.get(k) ?? 0) + d)
  }
  const start = addDays(t, -(days - 1))
  for (const [k, v] of byDay) if (k < start) nw += v
  const out: number[] = []
  for (let i = 0; i < days; i++) {
    const k = addDays(start, i)
    nw += byDay.get(k) ?? 0
    out.push(nw)
  }
  return out
}
export function accountSeries(s: FinState, acct: Account, days = 60): number[] {
  const t = today()
  const start = addDays(t, -(days - 1))
  let b = acct.opening
  const byDay = new Map<string, number>()
  for (const r of s.records) {
    const v = signedFor(r, acct.id)
    if (!v) continue
    const k = recDay(r)
    if (k < start) b += v
    else byDay.set(k, (byDay.get(k) ?? 0) + v)
  }
  const out: number[] = []
  for (let i = 0; i < days; i++) {
    b += byDay.get(addDays(start, i)) ?? 0
    out.push(b)
  }
  return out
}
export const isFlow = (r: FinRecord) => r.type !== "transfer" && !r.isAdjustment
export interface Flow {
  income: number
  spend: number
  byCat: Map<string, number>
  byPayee: Map<string, number>
  count: number
}
export function flowIn(s: FinState, from: string, to: string): Flow {
  const cats = catMap(s)
  const f: Flow = {
    income: 0,
    spend: 0,
    byCat: new Map(),
    byPayee: new Map(),
    count: 0,
  }
  for (const r of s.records) {
    if (!isFlow(r)) continue
    const k = recDay(r)
    if (k < from || k > to) continue
    f.count++
    if (r.type === "income" && !r.isRefund) {
      f.income += r.amount
      continue
    }
    const v = r.type === "expense" ? r.amount : -r.amount
    f.spend += v
    const top = topCat(r.categoryId, cats)?.id ?? "uncat"
    f.byCat.set(top, (f.byCat.get(top) ?? 0) + v)
    if (r.payee && r.type === "expense")
      f.byPayee.set(r.payee, (f.byPayee.get(r.payee) ?? 0) + v)
  }
  return f
}
export const savingsRate = (f: Flow) =>
  f.income > 0 ? (f.income - f.spend) / f.income : 0
export function spendIn(
  s: FinState,
  from: string,
  to: string,
  ids: string[] | null,
  cats = catMap(s),
) {
  let v = 0
  for (const r of s.records) {
    if (!isFlow(r)) continue
    const k = recDay(r)
    if (k < from || k > to) continue
    if (r.type === "income" && !r.isRefund) continue
    if (!inScope(r.categoryId, ids, cats)) continue
    v += r.type === "expense" ? r.amount : -r.amount
  }
  return v
}
export function noSpendDays(s: FinState, from: string, to: string) {
  const cats = catMap(s)
  const spent = new Set<string>()
  for (const r of s.records) {
    if (r.type !== "expense" || r.isAdjustment) continue
    if (!cats.get(r.categoryId ?? "")?.discretionary) continue
    spent.add(recDay(r))
  }
  const days: {
    key: string
    free: boolean
  }[] = []
  const t = today()
  for (let k = from; k <= to && k <= t; k = addDays(k, 1))
    days.push({ key: k, free: !spent.has(k) })
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (!days[i].free) break
    streak++
  }
  return { days, count: days.filter((d) => d.free).length, streak }
}
export interface BudgetView {
  b: Budget
  spent: number
  limit: number
  pct: number
  pace: number
  daysLeft: number
  safePerDay: number
  from: string
  to: string
}
export function todayAllowance(v: BudgetView, spentToday: number): number {
  return Math.max(0, v.limit - v.spent + spentToday) / (v.daysLeft + 1)
}
export function budgetView(s: FinState, b: Budget, mk?: string): BudgetView {
  const sd = s.settings.monthStartDay
  const t = today()
  const month = mk ?? monthOf(t, sd)
  const [from, to] = monthRange(month, sd)
  const spent = spendIn(s, from, to, b.categoryIds)
  const total = diffDays(to, from) + 1
  const elapsed = Math.min(total, Math.max(0, diffDays(t, from) + 1))
  const daysLeft = Math.max(0, total - elapsed)
  const left = b.limit - spent
  return {
    b,
    spent,
    limit: b.limit,
    pct: b.limit ? spent / b.limit : 0,
    pace: elapsed / total,
    daysLeft,
    safePerDay: daysLeft > 0 ? Math.max(0, left) / (daysLeft + 1) : 0,
    from,
    to,
  }
}
export function avgSpend(s: FinState, ids: string[] | null, months = 3) {
  const sd = s.settings.monthStartDay
  const cur = monthOf(today(), sd)
  let sum = 0
  let n = 0
  for (let i = 1; i <= months; i++) {
    const [f, t] = monthRange(addMonths(cur, -i), sd)
    if (f < addDays(today(), -95)) continue
    sum += spendIn(s, f, t, ids)
    n++
  }
  return n ? sum / n : 0
}
function occursOn(p: PlannedItem, k: string): boolean {
  const sc = p.schedule
  const d = parseKey(k)
  const dom = d.getDate()
  const last = lastDom(d.getFullYear(), d.getMonth())
  switch (sc.kind) {
    case "once":
      return k === sc.date
    case "monthly":
      return dom === Math.min(sc.day, last)
    case "semimonthly":
      return sc.days.some((x) => dom === Math.min(x, last))
    case "weekly": {
      const diff = diffDays(k, sc.anchor)
      return diff >= 0 && diff % (7 * sc.every) === 0
    }
  }
}
export function occurrences(
  p: PlannedItem,
  from: string,
  to: string,
): string[] {
  const out: string[] = []
  const start = p.schedule.kind === "once" ? p.schedule.date : p.start
  if (p.schedule.kind === "once") {
    const d = p.schedule.date
    return d >= from && d <= to ? [d] : []
  }
  let n = 0
  const endDate = p.end.kind === "date" ? p.end.date : "9999-12-31"
  const stop = to < endDate ? to : endDate
  for (let k = start; k <= stop; k = addDays(k, 1)) {
    if (!occursOn(p, k)) continue
    n++
    if (p.end.kind === "count" && n > p.end.n) break
    if (k >= from) out.push(k)
  }
  return out
}
export type OccStatus = "paid" | "skipped" | "due" | "upcoming" | "overdue"
export interface Occurrence {
  item: PlannedItem
  day: string
  orig: string
  status: OccStatus
  recordId?: string
}
export function paidIndex(s: FinState) {
  const idx = new Map<string, string>()
  for (const r of s.records)
    if (r.plannedId && r.plannedOn)
      idx.set(`${r.plannedId}|${r.plannedOn}`, r.id)
  return idx
}
export function occurrencesIn(
  s: FinState,
  from: string,
  to: string,
  opts: {
    includeWhatIf?: boolean
  } = {},
): Occurrence[] {
  const t = today()
  const paid = paidIndex(s)
  const out: Occurrence[] = []
  for (const p of s.planned) {
    if (p.archived || (p.isWhatIf && !opts.includeWhatIf)) continue
    for (const orig of occurrences(p, addDays(from, -14), to)) {
      const day = p.snoozed[orig] ?? orig
      if (day < from || day > to) continue
      const recordId = paid.get(`${p.id}|${orig}`)
      const status: OccStatus = recordId
        ? "paid"
        : p.skipped.includes(orig)
          ? "skipped"
          : day < t
            ? "overdue"
            : day <= addDays(t, 1)
              ? "due"
              : "upcoming"
      out.push({ item: p, day, orig, status, recordId })
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day))
}
export function dueNow(s: FinState) {
  const t = today()
  return occurrencesIn(s, addDays(t, -14), addDays(t, 1)).filter(
    (o) => o.status === "overdue" || o.status === "due",
  )
}
export function monthlyEq(p: PlannedItem) {
  switch (p.schedule.kind) {
    case "once":
      return 0
    case "monthly":
      return p.amount
    case "semimonthly":
      return p.amount * 2
    case "weekly":
      return (p.amount * 52) / 12 / p.schedule.every
  }
}
export function scheduleLabel(p: PlannedItem) {
  const sc = p.schedule
  const ord = (n: number) =>
    `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`
  const end =
    p.end.kind === "count"
      ? ` · ${p.end.n}×`
      : p.end.kind === "date"
        ? ` · until ${shortDate(p.end.date)}`
        : ""
  switch (sc.kind) {
    case "once":
      return `Once · ${shortDate(sc.date)}`
    case "monthly":
      return `Monthly on the ${ord(sc.day)}${end}`
    case "semimonthly":
      return `Semi-monthly · ${ord(sc.days[0])} & ${ord(sc.days[1])}${end}`
    case "weekly":
      return `${sc.every === 1 ? "Weekly" : `Every ${sc.every} weeks`}${end}`
  }
}
export interface ProjMonth {
  key: string
  inflow: number
  planned: number
  unplanned: number
  whatIf: number
  net: number
  end: number
  endBase: number
}
export interface Projection {
  start: number
  months: ProjMonth[]
  avgUnplanned: number
  low: {
    value: number
    key: string
  }
  lowBase: {
    value: number
    key: string
  }
  avgSurplus: number
  hasIncome: boolean
  recoveryMonths: number | null
}
export interface WhatIf {
  amount: number
  month: string
  installments: number
}
export function avgUnplanned(s: FinState) {
  const t = today()
  const cur = monthOf(t, 1)
  let sum = 0
  for (let i = 1; i <= 3; i++) {
    const [f, to] = monthRange(addMonths(cur, -i), 1)
    for (const r of s.records) {
      if (!isFlow(r) || r.plannedId) continue
      const k = recDay(r)
      if (k < f || k > to) continue
      if (r.type === "expense") sum += r.amount
      else if (r.isRefund) sum -= r.amount
    }
  }
  return sum / 3
}
export function project(
  s: FinState,
  opts: {
    horizon: number
    includeUnplanned: boolean
    excludedPlanned?: string[]
    excludedAccounts?: string[]
    whatIf?: WhatIf | null
    extraPlanned?: PlannedItem[]
  },
): Projection {
  const t = today()
  const bal = balances(s)
  const excl = opts.excludedAccounts ?? []
  const liquidIds = new Set(
    s.accounts
      .filter((a) => a.inProjection && !a.archived && !excl.includes(a.id))
      .map((a) => a.id),
  )
  const start = [...liquidIds].reduce((sum, id) => sum + bal[id], 0)
  const avgU = avgUnplanned(s)
  const cur = monthOf(t, 1)
  const items = [
    ...s.planned.filter(
      (p) =>
        !p.archived &&
        !p.isWhatIf &&
        p.inProjection &&
        !(opts.excludedPlanned ?? []).includes(p.id),
    ),
    ...(opts.extraPlanned ?? []),
  ]
  const paid = paidIndex(s)
  let end = start
  let endBase = start
  const months: ProjMonth[] = []
  let hasIncome = false
  for (let i = 0; i < opts.horizon; i++) {
    const mk = addMonths(cur, i)
    const [mf, mt] = monthRange(mk, 1)
    const from = i === 0 ? addDays(t, 1) : mf
    let inflow = 0
    let plannedOut = 0
    for (const p of items) {
      for (const o of occurrences(p, from, mt)) {
        if (paid.has(`${p.id}|${o}`) || p.skipped.includes(o)) continue
        if (p.type === "income") {
          inflow += p.amount
          hasIncome = true
        } else if (p.type === "expense") plannedOut += p.amount
        else {
          const fromLiquid = liquidIds.has(p.accountId)
          const toLiquid = !!p.toAccountId && liquidIds.has(p.toAccountId)
          if (fromLiquid && !toLiquid) plannedOut += p.amount
          if (!fromLiquid && toLiquid) inflow += p.amount
        }
      }
    }
    const share =
      i === 0 ? Math.max(0, diffDays(mt, t)) / (diffDays(mt, mf) + 1) : 1
    const unplanned = opts.includeUnplanned ? avgU * share : 0
    let whatIf = 0
    const w = opts.whatIf
    if (w && w.amount > 0) {
      const idx = monthIndex(w.month, cur)
      const n = Math.max(1, w.installments)
      if (i >= idx && i < idx + n) whatIf = w.amount / n
    }
    const netBase = inflow - plannedOut - unplanned
    endBase += netBase
    end += netBase - whatIf
    months.push({
      key: mk,
      inflow,
      planned: plannedOut,
      unplanned,
      whatIf,
      net: netBase - whatIf,
      end,
      endBase,
    })
  }
  const lowOf = (sel: (m: ProjMonth) => number) =>
    months.reduce(
      (lo, m) => (sel(m) < lo.value ? { value: sel(m), key: m.key } : lo),
      { value: start, key: cur },
    )
  let recoveryMonths: number | null = null
  if (opts.whatIf && opts.whatIf.amount > 0) {
    const idx = monthIndex(opts.whatIf.month, cur)
    const before = idx > 0 ? months[idx - 1]?.end : start
    if (before !== undefined) {
      const back = months.findIndex((m, i) => i >= idx && m.end >= before)
      recoveryMonths = back === -1 ? null : back - idx + 1
    }
  }
  const full = months.slice(1)
  return {
    start,
    months,
    avgUnplanned: avgU,
    low: lowOf((m) => m.end),
    lowBase: lowOf((m) => m.endBase),
    avgSurplus: full.length
      ? full.reduce((s2, m) => s2 + m.net + m.whatIf, 0) / full.length
      : 0,
    hasIncome,
    recoveryMonths,
  }
}
const monthIndex = (mk: string, cur: string) => {
  const [y1, m1] = mk.split("-").map(Number)
  const [y0, m0] = cur.split("-").map(Number)
  return (y1 - y0) * 12 + (m1 - m0)
}
export function guessPayee(raw: string) {
  const hit = RAW_HINTS.find((h) => h.match.test(raw))
  if (hit) return { payee: hit.payee, cat: hit.cat }
  const cleaned = raw
    .replace(/^(Payment to|Bills Payment —|Received money from)\s*/i, "")
    .toLowerCase()
    .replace(/\b\w/g, (x) => x.toUpperCase())
  return { payee: cleaned, cat: undefined }
}
export function reconcile(
  s: FinState,
  accountId: string,
  rows: StatementRow[],
  importId: string,
): ImportRow[] {
  const recs = s.records.filter(
    (r) => r.accountId === accountId || r.toAccountId === accountId,
  )
  const claimed = new Set<string>()
  const seen = new Set<string>()
  const dir = (r: FinRecord) => (signedFor(r, accountId) > 0 ? "in" : "out")
  const out: ImportRow[] = rows.map((row, i) => {
    const g = guessPayee(row.raw)
    const isTransfer = /cash-in|transfer/i.test(row.raw)
    return {
      ...row,
      id: `${importId}-${i}`,
      payee: isTransfer ? "Cash-in" : g.payee,
      suggestedCategoryId: isTransfer ? undefined : g.cat,
      categoryId: isTransfer ? undefined : g.cat,
      state: "new",
      confidence: 0.86,
      decision: "accept",
      isTransfer,
    }
  })
  for (const r of out) {
    if (r.pending) {
      Object.assign(r, {
        state: "pending",
        decision: "ignore",
        reason: "Pending authorisation — not final yet",
      })
      continue
    }
    const sig = `${r.ref}|${r.date}|${r.amount}|${r.raw}`
    if (seen.has(sig))
      Object.assign(r, {
        state: "duplicate",
        decision: "ignore",
        reason: "Appears twice in this file",
      })
    seen.add(sig)
  }
  const open = () => out.filter((r) => r.state === "new")
  for (const r of open()) {
    const cand = recs.find(
      (x) =>
        !claimed.has(x.id) &&
        dir(x) === r.direction &&
        x.amount === r.amount &&
        Math.abs(diffDays(recDay(x), r.date)) <= 1,
    )
    if (!cand) continue
    claimed.add(cand.id)
    if (cand.importId && cand.importId !== importId) {
      Object.assign(r, {
        state: "duplicate",
        decision: "ignore",
        matchId: cand.id,
        reason: "Already matched in an earlier import",
      })
    } else
      Object.assign(r, {
        state: "matched",
        decision: "accept",
        matchId: cand.id,
        confidence: 0.97,
      })
  }
  for (const r of open()) {
    const cand = recs.find(
      (x) =>
        !claimed.has(x.id) &&
        dir(x) === r.direction &&
        Math.abs(x.amount - r.amount) <= Math.max(30, r.amount * 0.1) &&
        Math.abs(diffDays(recDay(x), r.date)) <= 3 &&
        (x.amount !== r.amount || recDay(x) !== r.date),
    )
    if (!cand) continue
    claimed.add(cand.id)
    Object.assign(r, {
      state: "probable",
      decision: "take",
      matchId: cand.id,
      confidence: cand.amount === r.amount ? 0.74 : 0.62,
      reason:
        cand.amount !== r.amount
          ? "Amount differs from your transaction"
          : "Date differs from your transaction",
    })
  }
  for (const r of open()) {
    if (/send money/i.test(r.raw)) {
      r.confidence = 0.48
      r.reason = "Unclear purpose — pick a category"
      r.categoryId = undefined
    }
  }
  return out
}
export const needsAttention = (r: ImportRow) =>
  r.state === "probable" ||
  r.state === "duplicate" ||
  r.state === "pending" ||
  (r.state === "new" && r.confidence < 0.7)
export const rowSigned = (r: { amount: number; direction: "in" | "out" }) =>
  r.direction === "in" ? r.amount : -r.amount
export function statementClosing(
  s: FinState,
  accountId: string,
  to: string,
  rows: ImportRow[],
) {
  const acct = s.accounts.find((a) => a.id === accountId)
  if (!acct) return 0
  let b = balanceOf(s, acct, to)
  const recs = new Map(s.records.map((r) => [r.id, r]))
  for (const r of rows) {
    if (r.state === "new") b += rowSigned(r)
    if (r.state === "probable" && r.matchId) {
      const x = recs.get(r.matchId)
      if (x) b += rowSigned(r) - signedFor(x, accountId)
    }
  }
  return b
}
export const compact = (n: number) => moneyCompact(n)
export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`
export function suggestCategory(
  s: FinState,
  payee: string,
): string | undefined {
  const p = payee.trim().toLowerCase()
  if (!p) return undefined
  for (let i = s.records.length - 1; i >= 0; i--) {
    const r = s.records[i]
    if (r.payee?.toLowerCase().startsWith(p) && r.categoryId)
      return r.categoryId
  }
  return guessPayee(payee).cat
}
export function recentCategories(s: FinState, n = 8): string[] {
  const t = today()
  const from = addDays(t, -30)
  const count = new Map<string, number>()
  for (const r of s.records) {
    if (r.type !== "expense" || !r.categoryId || r.isAdjustment) continue
    if (recDay(r) < from) continue
    count.set(r.categoryId, (count.get(r.categoryId) ?? 0) + 1)
  }
  const ranked = [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((x) => x[0])
  const last = s.settings.lastCategoryId
  const ordered = last ? [last, ...ranked.filter((x) => x !== last)] : ranked
  return ordered.slice(0, n)
}
export function lastReconciledDays(a: Account) {
  return a.lastReconciled ? diffDays(today(), a.lastReconciled) : null
}
