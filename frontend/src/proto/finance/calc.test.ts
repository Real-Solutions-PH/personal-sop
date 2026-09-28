import { expect, test } from "bun:test"
import { type BudgetView, todayAllowance } from "./calc"

const view = (limit: number, spent: number, daysLeft: number) =>
  ({ limit, spent, daysLeft }) as BudgetView

test("todayAllowance is fixed at the start-of-day figure", () => {
  // ₱10,000 month, ₱7,000 spent before today, 9 days after today → ₱300/day
  expect(todayAllowance(view(10_000, 7_000, 9), 0)).toBe(300)
  // spending ₱500 today does not move today's allowance
  expect(todayAllowance(view(10_000, 7_500, 9), 500)).toBe(300)
  // last day of the period: everything left is today's
  expect(todayAllowance(view(10_000, 9_000, 0), 200)).toBe(1_200)
  // already over the monthly limit → nothing to spend
  expect(todayAllowance(view(10_000, 12_000, 5), 0)).toBe(0)
})
