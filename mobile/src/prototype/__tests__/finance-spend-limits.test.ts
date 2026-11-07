// What the home's spend figures are judged against: the overall budget only.
import { spendLimits } from "@domain/finance/calc"
import type { Budget, FinRecord, FinState } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  // 20 Nov: 10 days left after today in a 30-day November.
  jest.useFakeTimers({ now: new Date("2026-11-20T10:00:00") })
})
afterEach(() => jest.useRealTimers())

const budget = (categoryIds: string[] | null, limit: number): Budget => ({
  id: categoryIds ? "food" : "all",
  name: categoryIds ? "Food" : "Everything",
  categoryIds,
  period: "monthly",
  limit,
  rollover: false,
  startDate: "2026-01-01",
  archived: false,
})
const spend = (id: string, amount: number, day: string): FinRecord => ({
  id,
  type: "expense",
  amount,
  accountId: "a1",
  at: `${day}T09:00:00`,
  source: "manual",
  status: "cleared",
})
const state = (budgets: Budget[], records: FinRecord[]): FinState => {
  const s = finStore.get()
  return {
    ...s,
    budgets,
    records,
    settings: { ...s.settings, monthStartDay: 1 },
  }
}

test("today's line is what was safe as the day began, so spending does not lower it", () => {
  // 30,000 for November; 19,000 gone before today, 11,000 left over the
  // 11 days from today: 1,000 a day. Spending 910 today keeps it 1,000.
  const l = spendLimits(
    state(
      [budget(null, 30_000)],
      [spend("a", 19_000, "2026-11-10"), spend("b", 910, "2026-11-20")],
    ),
  )
  expect(l).toEqual({ today: 1_000, perDay: 1_000, perMonth: 30_000 })
})

test("category budgets alone judge nothing: they cover only part of the spending", () => {
  expect(spendLimits(state([budget(["food"], 10_000)], []))).toBeNull()
})

test("an archived overall budget judges nothing", () => {
  const b = { ...budget(null, 30_000), archived: true }
  expect(spendLimits(state([b], []))).toBeNull()
})
