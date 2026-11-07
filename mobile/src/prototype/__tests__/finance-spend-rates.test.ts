// The Finance home's spend figures: what went out today, the average a day
// over the last 30 days, and the average a budget month.
import { spendRates } from "@domain/finance/calc"
import type { FinRecord, FinState } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

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
  accountId: "a1",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
  ...extra,
})
const only = (records: FinRecord[], monthStartDay = 1): FinState => {
  const s = finStore.get()
  return { ...s, records, settings: { ...s.settings, monthStartDay } }
}

test("today counts only today's spending, net of refunds", () => {
  const r = spendRates(
    only([
      rec("a", "expense", 250, "2026-11-07"),
      rec("b", "expense", 100.5, "2026-11-07"),
      rec("c", "income", 40, "2026-11-07", { isRefund: true }),
      rec("d", "expense", 999, "2026-11-06"),
      rec("e", "income", 5_000, "2026-11-07"),
    ]),
    "2026-11-07",
  )
  expect(r.today).toBe(310.5)
})

test("transfers and balance adjustments are not spending", () => {
  const r = spendRates(
    only([
      rec("t", "transfer", 3_000, "2026-11-07", { toAccountId: "a2" }),
      rec("x", "expense", 700, "2026-11-07", { isAdjustment: true }),
    ]),
    "2026-11-07",
  )
  expect(r).toMatchObject({ today: 0, perDay: 0 })
})

test("the daily average covers the last 30 days, today included", () => {
  const r = spendRates(
    only([
      rec("old", "expense", 10_000, "2026-08-01"),
      // 8 Oct is the 31st day back: outside the window.
      rec("out", "expense", 5_000, "2026-10-08"),
      rec("in1", "expense", 1_500, "2026-10-09"),
      rec("in2", "expense", 1_500, "2026-11-07"),
    ]),
    "2026-11-07",
  )
  expect(r.days).toBe(30)
  expect(r.perDay).toBe(100)
})

test("someone tracking for less than 30 days is averaged over the days they tracked", () => {
  const r = spendRates(
    only([
      rec("a", "expense", 600, "2026-11-02"),
      rec("b", "expense", 600, "2026-11-07"),
    ]),
    "2026-11-07",
  )
  // 2–7 Nov: six days.
  expect(r.days).toBe(6)
  expect(r.perDay).toBe(200)
})

test("the monthly average is over the last three complete budget months", () => {
  const r = spendRates(
    only([
      rec("jul", "expense", 1_000, "2026-07-20"),
      rec("aug", "expense", 9_000, "2026-08-10"),
      rec("sep", "expense", 12_000, "2026-09-10"),
      rec("oct", "expense", 15_000, "2026-10-10"),
      rec("nov", "expense", 99_999, "2026-11-03"),
    ]),
    "2026-11-07",
  )
  expect(r.months).toBe(3)
  expect(r.perMonth).toBe(12_000)
})

test("a month only partly tracked is left out of the monthly average", () => {
  const r = spendRates(
    only([
      rec("sep", "expense", 3_000, "2026-09-20"),
      rec("oct", "expense", 15_000, "2026-10-10"),
    ]),
    "2026-11-07",
  )
  expect(r.months).toBe(1)
  expect(r.perMonth).toBe(15_000)
})

test("budget months follow the month start day", () => {
  const r = spendRates(
    only(
      [
        rec("a", "expense", 2_000, "2026-09-25"),
        rec("b", "expense", 4_000, "2026-10-24"),
        rec("c", "expense", 6_000, "2026-10-25"),
      ],
      25,
    ),
    "2026-11-07",
  )
  // 25 Sep – 24 Oct is the only complete month; 25 Oct onwards is this one.
  expect(r.months).toBe(1)
  expect(r.perMonth).toBe(6_000)
})

test("with no complete month yet, the month is estimated from the daily average", () => {
  const r = spendRates(
    only([rec("a", "expense", 1_200, "2026-11-02")]),
    "2026-11-07",
  )
  expect(r.months).toBe(0)
  // ₱200 a day over November's 30 days.
  expect(r.perMonth).toBe(6_000)
})

test("nothing recorded yet is all zeros", () => {
  expect(spendRates(only([]), "2026-11-07")).toEqual({
    today: 0,
    perDay: 0,
    perMonth: 0,
    days: 0,
    months: 0,
  })
})
