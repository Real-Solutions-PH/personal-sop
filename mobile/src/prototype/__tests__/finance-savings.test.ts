// Savings on an account: interest after the 20% withholding tax, interest
// earned this year, a time deposit's maturity, and progress to a goal.
import { savingsView } from "@domain/finance/calc"
import type { Account, FinRecord, FinState } from "@domain/finance/data"
import { RATES, rateLabel } from "@domain/finance/rates"
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

const on = "2026-10-25"
const acct = (extra: Partial<Account>): Account => ({
  ...finStore.get().accounts[0],
  id: "sav",
  ...extra,
})
const income = (
  id: string,
  at: string,
  amount: number,
  categoryId: string,
  accountId = "sav",
): FinRecord =>
  ({
    ...finStore.get().records[0],
    id,
    type: "income",
    amount,
    accountId,
    toAccountId: undefined,
    categoryId,
    at: `${at}T12:00:00`,
  }) as FinRecord
const state = (records: FinRecord[]): FinState => ({
  ...finStore.get(),
  records,
})

test("monthly interest is a twelfth of the yearly rate, net of 20% tax", () => {
  const v = savingsView(state([]), acct({ rate: 4 }), 100_000, on)
  // 100,000 × 4% × 0.8 / 12
  expect(v.monthlyInterest).toBe(266.67)
})

test("no rate, no estimate; a negative balance earns nothing", () => {
  expect(savingsView(state([]), acct({}), 5000, on).monthlyInterest).toBeNull()
  expect(
    savingsView(state([]), acct({ rate: 4 }), -100, on).monthlyInterest,
  ).toBe(0)
})

test("interest earned counts only this year's interest income on this account", () => {
  const s = state([
    income("a", "2026-03-01", 120, "interest"),
    income("b", "2026-09-30", 80.5, "interest"),
    income("c", "2025-12-31", 999, "interest"),
    income("d", "2026-05-01", 500, "salary"),
    income("e", "2026-05-01", 70, "interest", "other"),
  ])
  expect(savingsView(s, acct({}), 0, on).earnedThisYear).toBe(200.5)
})

test("a time deposit counts down to maturity and grows to its net value", () => {
  const v = savingsView(
    state([]),
    acct({ rate: 5, maturesOn: "2027-10-25" }),
    100_000,
    on,
  )
  expect(v.maturesIn).toBe(365)
  // 100,000 + 100,000 × 5% × 0.8
  expect(v.maturityValue).toBe(104_000)
  const done = savingsView(
    state([]),
    acct({ rate: 5, maturesOn: "2026-10-01" }),
    100_000,
    on,
  )
  expect(done.maturesIn).toBeLessThan(0)
  expect(done.maturityValue).toBe(100_000)
})

test("a goal shows progress and what is still needed each month", () => {
  const v = savingsView(
    state([]),
    acct({ goal: 50_000, goalBy: "2027-04-30" }),
    20_000,
    on,
  )
  expect(v.goalProgress).toBe(0.4)
  // 30,000 left over the 6 months from October to April
  expect(v.perMonth).toBe(5000)
  const met = savingsView(state([]), acct({ goal: 1000 }), 2000, on)
  expect(met.goalProgress).toBe(1)
  expect(met.perMonth).toBeNull()
  // A goal date already past asks for nothing per month; the panel says what's left.
  const late = savingsView(
    state([]),
    acct({ goal: 50_000, goalBy: "2026-01-31" }),
    20_000,
    on,
  )
  expect(late.perMonth).toBeNull()
})

test("every listed rate is a sane range", () => {
  for (const r of RATES) {
    expect(r.min).toBeGreaterThan(0)
    expect(r.max).toBeGreaterThanOrEqual(r.min)
  }
  expect(rateLabel(RATES[0])).toBe("3.5% – 15%")
})
