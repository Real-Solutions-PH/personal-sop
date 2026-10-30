// A day-by-day forecast over a picked future range: money on hand on the
// start and end dates, and the income, bills and everyday spending inside.
import {
  addDays,
  addMonths,
  monthOf,
  monthRange,
  project,
} from "@domain/finance/calc"
import type { FinRecord, FinState, PlannedItem } from "@domain/finance/data"
import { aheadRangeError, forecast } from "@domain/finance/forecast"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const today = dayKey()
const item = (
  id: string,
  type: PlannedItem["type"],
  amount: number,
  schedule: PlannedItem["schedule"],
  extra: Partial<PlannedItem> = {},
): PlannedItem => ({
  id,
  name: id,
  type,
  amount,
  estimated: false,
  accountId: "wallet",
  schedule,
  start: addDays(today, -400),
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})
const once = (
  id: string,
  type: PlannedItem["type"],
  amount: number,
  day: string,
  extra: Partial<PlannedItem> = {},
) => item(id, type, amount, { kind: "once", date: day }, extra)
const rec = (
  id: string,
  type: FinRecord["type"],
  amount: number,
  day: string,
  extra: Partial<FinRecord> = {},
): FinRecord => ({
  id,
  type,
  amount,
  accountId: "wallet",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
  ...extra,
})

function state(planned: PlannedItem[], records: FinRecord[] = []): FinState {
  const s = finStore.get()
  const base = s.accounts[0]
  const acct = (id: string, opening: number, inProjection = true) => ({
    ...base,
    id,
    opening,
    openingDate: addDays(today, -400),
    inProjection,
    inNetWorth: true,
    archived: false,
  })
  return {
    ...s,
    records,
    settings: {
      ...s.settings,
      includeUnplanned: false,
      projExcludedPlanned: [],
    },
    accounts: [acct("wallet", 40000), acct("invest", 5000, false)],
    planned,
  }
}
const off = { includeUnplanned: false }

test("money on hand on the end date: income and bills on their days", () => {
  const s = state([
    once("pay1", "income", 25000, addDays(today, 11)),
    once("pay2", "income", 25000, addDays(today, 26)),
    once("pay3", "income", 25000, addDays(today, 41)),
    once("rent1", "expense", 15000, addDays(today, 2)),
    once("rent2", "expense", 15000, addDays(today, 32)),
    once("later", "expense", 9999, addDays(today, 60)),
  ])
  const f = forecast(s, today, addDays(today, 46), off)
  expect(f.start).toBe(40000)
  expect(f.atTo).toBe(40000 + 25000 * 3 - 15000 * 2)
  expect([f.income, f.bills, f.everyday, f.net]).toEqual([
    75000, 30000, 0, 45000,
  ])
  expect(f.days).toHaveLength(47)
  expect(f.hasIncome).toBe(true)
})

test("everyday spending is spread by day and lowers the end balance by the same amount", () => {
  const mk = monthOf(today, 1)
  const records = [1, 2, 3].map((i) =>
    rec(`r${i}`, "expense", 18250, `${addMonths(mk, -i)}-10`),
  )
  const s = state([], records)
  const start = forecast(s, today, today, off).start
  const f = forecast(s, today, addDays(today, 46), { includeUnplanned: true })
  expect(f.everyday).toBeCloseTo(((18250 * 12) / 365) * 46)
  expect(f.atTo).toBeCloseTo(start - f.everyday)
  expect(f.days[0].everyday).toBe(0)
})

test("a start date in the future carries what happens before it into the start balance only", () => {
  const s = state([
    once("before", "income", 3000, addDays(today, 3)),
    once("inside", "expense", 1000, addDays(today, 12)),
  ])
  const f = forecast(s, addDays(today, 10), addDays(today, 20), off)
  expect(f.atFrom).toBe(43000)
  expect(f.atTo).toBe(42000)
  expect([f.income, f.bills]).toEqual([0, 1000])
  expect(f.items.map((o) => o.item.id)).toEqual(["inside"])
})

test("paid and skipped occurrences are left out", () => {
  const day = addDays(today, 5)
  const s = state(
    [
      once("paid", "expense", 700, day),
      once("skipped", "expense", 500, day, { skipped: [day] }),
    ],
    [rec("p", "expense", 700, today, { plannedId: "paid", plannedOn: day })],
  )
  const f = forecast(s, today, addDays(today, 10), off)
  expect(f.bills).toBe(0)
  expect(f.items).toHaveLength(0)
})

test("an overdue unpaid bill lands on today", () => {
  const s = state([once("late", "expense", 1000, addDays(today, -3))])
  const f = forecast(s, today, addDays(today, 5), off)
  expect(f.days[0].balance).toBe(39000)
  expect(f.bills).toBe(1000)
  const later = forecast(s, addDays(today, 1), addDays(today, 5), off)
  expect(later.bills).toBe(0)
  expect(later.atTo).toBe(39000)
})

test("transfers count only when they cross the edge of the counted accounts", () => {
  const day = addDays(today, 2)
  const s = state([
    once("out", "transfer", 2000, day, { toAccountId: "invest" }),
    once("in", "transfer", 500, day, {
      accountId: "invest",
      toAccountId: "wallet",
    }),
    once("inside", "transfer", 900, day, { toAccountId: "wallet" }),
  ])
  const f = forecast(s, today, addDays(today, 3), off)
  expect([f.income, f.bills]).toEqual([500, 2000])
  expect(f.atTo).toBe(38500)
})

test("excluded planned items, items left out of the projection and unticked accounts are honoured", () => {
  const day = addDays(today, 1)
  const s = state([
    once("excluded", "expense", 100, day),
    once("maybe", "expense", 200, day, { inProjection: false }),
    once("kept", "expense", 300, day),
  ])
  const f = forecast(s, today, addDays(today, 2), {
    includeUnplanned: false,
    excludedPlanned: ["excluded"],
  })
  expect(f.bills).toBe(300)
  const none = forecast(s, today, addDays(today, 2), {
    includeUnplanned: false,
    excludedAccounts: ["wallet"],
  })
  expect(none.start).toBe(0)
  expect(none.bills).toBe(0)
})

test("the lowest point is found inside the range only", () => {
  const s = state([
    once("dip", "expense", 30000, addDays(today, 2)),
    once("back", "income", 30000, addDays(today, 4)),
    once("small", "expense", 1000, addDays(today, 8)),
  ])
  const f = forecast(s, addDays(today, 6), addDays(today, 10), off)
  expect(f.atFrom).toBe(40000)
  expect(f.low).toEqual({ day: addDays(today, 8), value: 39000 })
})

test("over whole months it agrees with the monthly projection", () => {
  // Nothing overdue (the daily view counts overdue items today, the monthly
  // one does not) and nothing on today (the monthly one starts tomorrow).
  const dom = (k: string) => Math.min(28, Number(k.slice(8)))
  const s = state([
    item(
      "salary",
      "income",
      30000,
      {
        kind: "monthly",
        day: dom(addDays(today, 1)) === dom(today) ? 1 : dom(addDays(today, 1)),
      },
      { start: today },
    ),
    item(
      "rent",
      "expense",
      12000,
      {
        kind: "monthly",
        day: dom(addDays(today, 2)) === dom(today) ? 2 : dom(addDays(today, 2)),
      },
      { start: today },
    ),
  ])
  const to = monthRange(addMonths(monthOf(today, 1), 2), 1)[1]
  const f = forecast(s, today, to, off)
  const p = project(s, { horizon: 3, includeUnplanned: false })
  expect(f.atTo).toBe(p.months[2].end)
})

test("a 730-day range runs and has one point per day", () => {
  const s = state([
    item("salary", "income", 30000, { kind: "monthly", day: 15 }),
  ])
  const f = forecast(s, today, addDays(today, 730), off)
  expect(f.days).toHaveLength(731)
})

test("range limits: start from today, end after start, within 24 months", () => {
  expect(aheadRangeError({ from: today, to: addDays(today, -1) })).toBe(
    "Pick an end date after the start date",
  )
  expect(aheadRangeError({ from: addDays(today, -1), to: today })).toBe(
    "Pick a start date from today on",
  )
  expect(aheadRangeError({ from: today, to: addDays(today, 731) })).toBe(
    "Pick a date within 24 months",
  )
  expect(aheadRangeError({ from: today, to: addDays(today, 730) })).toBeNull()
})
