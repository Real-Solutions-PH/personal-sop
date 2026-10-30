// Date-driven forecasts: money on hand day by day up to a chosen date, the
// preset windows, and actual net worth against what repeats.
import { addDays, addMonths, monthOf, monthRange } from "@domain/finance/calc"
import type { FinRecord, FinState, PlannedItem } from "@domain/finance/data"
import {
  addMonthsToDay,
  aheadEnd,
  backRange,
  dailyForecast,
  expectedVsActual,
  liquidSeries,
} from "@domain/finance/forecast"
import { rangeReport } from "@domain/finance/reports"
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
): FinRecord => ({
  id,
  type,
  amount,
  accountId: "wallet",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
})

function state(
  planned: PlannedItem[],
  records: FinRecord[] = [],
  includeUnplanned = false,
): FinState {
  const s = finStore.get()
  const base = s.accounts[0]
  return {
    ...s,
    records,
    settings: { ...s.settings, includeUnplanned, projExcludedPlanned: [] },
    accounts: [
      {
        ...base,
        id: "wallet",
        opening: 10000,
        openingDate: addDays(today, -400),
        inProjection: true,
        inNetWorth: true,
        archived: false,
      },
    ],
    planned,
  }
}

test("money on hand by a date: scheduled items on their day, overdue today, skipped and paid out", () => {
  const s = state([
    once("rent", "expense", 8000, addDays(today, 3)),
    once("salary", "income", 20000, addDays(today, 5)),
    once("late", "expense", 1000, addDays(today, -2)),
    once("skipped", "expense", 500, addDays(today, 4), {
      skipped: [addDays(today, 4)],
    }),
    once("after", "expense", 9999, addDays(today, 30)),
  ])
  const f = dailyForecast(s, addDays(today, 6))
  expect(f.start).toBe(10000)
  expect(f.days).toHaveLength(7)
  expect(f.days[0]).toEqual({ day: today, balance: 9000 })
  expect(f.days[3].balance).toBe(1000)
  expect([f.comingIn, f.scheduledOut, f.everydayOut]).toEqual([20000, 9000, 0])
  expect(f.end).toBe(21000)
  expect(f.low).toEqual({ day: addDays(today, 3), value: 1000 })
  expect(f.items.map((o) => o.item.id)).toEqual(["late", "rent", "salary"])
})

test("items left out of the projection are listed but move nothing", () => {
  const s = state([
    once("maybe", "expense", 3000, addDays(today, 1), { inProjection: false }),
    once("excluded", "expense", 2000, addDays(today, 1)),
  ])
  s.settings.projExcludedPlanned = ["excluded"]
  const f = dailyForecast(s, addDays(today, 2))
  expect(f.items).toHaveLength(2)
  expect(f.scheduledOut).toBe(0)
  expect(f.end).toBe(10000)
})

test("everyday spending comes off one day at a time from tomorrow when included", () => {
  const mk = monthOf(today, 1)
  // 3,650 in each of the last three calendar months
  const records = [1, 2, 3].map((i) =>
    rec(`r${i}`, "expense", 3650, `${addMonths(mk, -i)}-10`),
  )
  const s = state([], records, true)
  const f = dailyForecast(s, addDays(today, 10))
  const perDay = f.everydayOut / 10
  expect(perDay).toBeCloseTo((3650 * 12) / 365)
  expect(f.days[0].balance).toBe(f.start)
  expect(f.days[1].balance).toBeCloseTo(f.start - perDay)
  expect(f.end).toBeCloseTo(f.start - f.everydayOut)
  const off = dailyForecast(s, addDays(today, 10), { includeUnplanned: false })
  expect(off.everydayOut).toBe(0)
})

test("a what-if purchase lands on the 15th, split over its installments", () => {
  const s = state([])
  const next = addMonthsToDay(today, 1).slice(0, 7)
  const f = dailyForecast(s, addMonthsToDay(today, 5), {
    whatIf: { amount: 30000, month: next, installments: 3 },
  })
  expect(f.scheduledOut).toBe(30000)
  expect(f.days.find((d) => d.day === `${next}-15`)?.balance).toBe(0)
  expect(f.end).toBe(-20000)
})

test("presets: months ahead keep the day; look-back windows follow the budget month", () => {
  expect(addMonthsToDay("2026-01-31", 1)).toBe("2026-02-28")
  expect(addMonthsToDay("2026-11-15", 3)).toBe("2027-02-15")
  const s = state([])
  expect(aheadEnd(s, "month")).toBe(monthRange(monthOf(today, 1), 1)[1])
  expect(aheadEnd(s, "1y")).toBe(addMonthsToDay(today, 12))
  expect(backRange(s, "this")).toEqual({
    from: monthRange(monthOf(today, 1), 1)[0],
    to: today,
  })
  expect(backRange(s, "6m").to).toBe(today)
})

test("net worth against what repeats: repeating items count on their day, logged or not", () => {
  const from = addDays(today, -9)
  const s = state(
    [
      item("weekly pay", "income", 1000, {
        kind: "weekly",
        every: 1,
        anchor: from,
      }),
      once("one-off", "expense", 5000, addDays(today, -5)),
      item(
        "draft",
        "expense",
        700,
        { kind: "weekly", every: 1, anchor: from },
        {
          isWhatIf: true,
        },
      ),
    ],
    [
      rec("before", "expense", 2000, addDays(from, -1)),
      rec("coffee", "expense", 300, addDays(from, 2)),
      rec("pay", "income", 1000, from),
    ],
  )
  const v = expectedVsActual(s, from, addDays(today, 30))
  expect(v.days).toHaveLength(10)
  expect(v.days.at(-1)).toBe(today)
  // both lines start from the balance before the window: 10,000 − 2,000
  expect(v.actual[0]).toBe(9000)
  expect(v.expected[0]).toBe(9000)
  // pay on day 0 and day 7; coffee on day 2
  expect(v.expected.at(-1)).toBe(10000)
  expect(v.actual.at(-1)).toBe(8700)
  expect(v.gap).toBe(-1300)
})

test("a custom report window compares with the same length before it", () => {
  const s = state([], [rec("a", "expense", 500, addDays(today, -3))])
  const r = rangeReport(s, { from: addDays(today, -6), to: today })
  expect(r.r.prevTo).toBe(addDays(today, -7))
  expect(r.r.prevFrom).toBe(addDays(today, -13))
  expect(r.flow.spend).toBe(500)
  expect(r.months.length).toBeGreaterThanOrEqual(3)
  expect(r.vs.days).toHaveLength(7)
  const year = rangeReport(s, backRange(s, "1y"))
  expect(year.months).toHaveLength(12)
  expect(year.budgets.every((b) => b.hist.length === 6)).toBe(true)
})

test("money on hand so far: one point a day up to today, ending at today's balance", () => {
  const s = state(
    [],
    [
      rec("old", "expense", 1000, addDays(today, -20)),
      rec("a", "expense", 400, addDays(today, -2)),
      rec("b", "income", 900, today),
    ],
  )
  const v = liquidSeries(s, addDays(today, -3), addDays(today, 5))
  expect(v).toEqual([9000, 8600, 8600, 9500])
  expect(v.at(-1)).toBe(dailyForecast(s, today).start)
})
