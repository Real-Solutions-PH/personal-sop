// Reports over a picked range: compared with the same number of days just
// before it, every card over the range only, and the fixed periods as they
// were.
import { addDays } from "@domain/finance/calc"
import type { FinRecord, FinState } from "@domain/finance/data"
import { backRangeError } from "@domain/finance/forecast"
import { periodRange, reportData } from "@domain/finance/reports"
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
const rec = (id: string, amount: number, day: string, payee: string) =>
  ({
    id,
    type: "expense",
    amount,
    accountId: finStore.get().accounts[0].id,
    categoryId: finStore.get().categories.find((c) => c.kind === "expense")?.id,
    payee,
    at: `${day}T12:00:00`,
    source: "manual",
    status: "cleared",
  }) as FinRecord

test("a custom range compares with the same number of days just before it", () => {
  const r = periodRange(finStore.get(), {
    from: "2026-08-01",
    to: "2026-10-30",
  })
  expect(r).toEqual({
    from: "2026-08-01",
    to: "2026-10-30",
    prevFrom: "2026-05-02",
    prevTo: "2026-07-31",
    label: "1 Aug – 30 Oct 2026",
  })
})

test("every card counts the range only", () => {
  const s: FinState = {
    ...finStore.get(),
    records: [
      rec("in", 300, addDays(today, -5), "Inside"),
      rec("out", 900, addDays(today, -40), "Outside"),
    ],
  }
  const p = { from: addDays(today, -9), to: today }
  const d = reportData(s, p)
  expect(d.flow.spend).toBe(300)
  expect(d.payees.map((x) => x[0])).toEqual(["Inside"])
  expect(d.byCat.reduce((a, x) => a + x[1], 0)).toBe(300)
  expect(d.daily).toHaveLength(10)
  expect(d.weekdayAvg.reduce((a, v) => a + v, 0)).toBeGreaterThan(0)
  expect(d.nw).toHaveLength(10)
  expect(d.budgets.every((b) => b.hist.length === 3)).toBe(true)
})

test("the fixed periods give what they gave before", () => {
  const s = finStore.get()
  for (const p of ["this", "last", "3m"] as const) {
    const d = reportData(s, p)
    expect(d.nw).toHaveLength(90)
    expect(d.months).toHaveLength(4)
    expect(d.budgets.every((b) => b.hist.length === 3)).toBe(true)
  }
  expect(periodRange(s, "3m").label).toBe("Last 3 months")
})

test("report range limits: ends today or earlier, at most 400 days", () => {
  expect(backRangeError({ from: addDays(today, -399), to: today })).toBeNull()
  expect(backRangeError({ from: addDays(today, -400), to: today })).toBe(
    "Pick a range of up to 400 days",
  )
  expect(backRangeError({ from: today, to: addDays(today, 1) })).toBe(
    "Pick an end date of today or earlier",
  )
})
