// The Finance home's budget headline: the overall budget when there is one,
// otherwise the category budgets added together, and nothing when no live
// budget exists (the card then shows its dimmed preview).
import {
  budgetSummary,
  budgetView,
  monthOf,
  monthRange,
  today,
} from "@domain/finance/calc"
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
})

const budget = (
  id: string,
  limit: number,
  categoryIds: string[] | null,
  extra: Partial<Budget> = {},
): Budget => ({
  id,
  name: id,
  categoryIds,
  period: "monthly",
  limit,
  rollover: false,
  startDate: "2020-01-01",
  archived: false,
  ...extra,
})
const spend = (id: string, amount: number, categoryId: string): FinRecord => ({
  id,
  type: "expense",
  amount,
  accountId: "wallet",
  categoryId,
  at: new Date().toISOString(),
  source: "manual",
  status: "cleared",
})

function state(budgets: Budget[], records: FinRecord[]): FinState {
  const s = finStore.get()
  return {
    ...s,
    records,
    budgets,
    categories: [
      {
        id: "trip",
        name: "Trip",
        kind: "expense",
        icon: "",
        discretionary: true,
        archived: false,
      },
      {
        id: "food",
        name: "Food",
        kind: "expense",
        icon: "",
        discretionary: true,
        archived: false,
      },
      {
        id: "gym",
        name: "Gym",
        kind: "expense",
        icon: "",
        discretionary: true,
        archived: false,
      },
      {
        id: "rent",
        name: "Rent",
        kind: "expense",
        icon: "",
        discretionary: false,
        archived: false,
      },
    ],
  }
}

// The month's own days left, read from the calendar rather than from the
// function under test.
function daysLeft() {
  const sd = finStore.get().settings.monthStartDay
  const [, to] = monthRange(monthOf(today(), sd), sd)
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() -
      new Date(`${today()}T00:00:00`).getTime()) /
      86_400_000,
  )
}

test("a month already over has nothing safe to spend", () => {
  const s = state([budget("Food", 1000, ["food"])], [])
  const sd = s.settings.monthStartDay
  const past = monthOf(
    new Date(Date.now() - 62 * 86_400_000).toISOString().slice(0, 10),
    sd,
  )
  const sum = budgetSummary(s, past)
  expect(sum?.left).toBe(1000)
  expect(sum?.safePerDay).toBe(0)
})

test("no live budget: no summary, so the card stays a dimmed preview", () => {
  expect(budgetSummary(state([], []))).toBeNull()
  const archived = budget("old", 5000, ["food"], { archived: true })
  expect(budgetSummary(state([archived], []))).toBeNull()
})

test("category budgets alone add up into the headline (Kai's three budgets)", () => {
  // Trip ₱15,000 with ₱3,354 spent, Food ₱10,000 with ₱965 spent, Gym
  // ₱5,000 untouched; ₱80,000 of rent sits outside every budget.
  const s = state(
    [
      budget("Trip", 15000, ["trip"]),
      budget("Food", 10000, ["food"]),
      budget("Gym", 5000, ["gym"]),
    ],
    [
      spend("a", 3354, "trip"),
      spend("b", 965, "food"),
      spend("c", 80000, "rent"),
    ],
  )
  const sum = budgetSummary(s)
  expect(sum).not.toBeNull()
  if (!sum) return
  expect(sum.source).toBe("categories")
  expect(sum.count).toBe(3)
  expect(sum.limit).toBe(30000)
  // rent is not under any budget, so it is not counted as budget spend
  expect(sum.spent).toBe(4319)
  expect(sum.left).toBe(25681)
  expect(sum.pct).toBeCloseTo(4319 / 30000, 10)
  const d = daysLeft()
  expect(sum.daysLeft).toBe(d)
  // today is a day to spend in, so even on the month's last day (d = 0)
  // what is left is today's rather than nothing
  expect(sum.safePerDay).toBeCloseTo(25681 / (d + 1), 10)
})

test("an overspent category eats into the room the others leave", () => {
  const s = state(
    [budget("Food", 1000, ["food"]), budget("Gym", 5000, ["gym"])],
    [spend("a", 3000, "food")],
  )
  const sum = budgetSummary(s)
  expect(sum?.left).toBe(3000)
  expect(sum?.pct).toBeCloseTo(0.5, 10)
})

test("all budgets over: left goes negative and safe per day floors at zero", () => {
  const s = state([budget("Food", 1000, ["food"])], [spend("a", 1500, "food")])
  const sum = budgetSummary(s)
  expect(sum?.left).toBe(-500)
  expect(sum?.safePerDay).toBe(0)
})

test("an overall budget is the headline as it is, ignoring category budgets", () => {
  const all = budget("All", 50000, null)
  const s = state(
    [budget("Food", 10000, ["food"]), all],
    [spend("a", 965, "food"), spend("b", 20000, "rent")],
  )
  const sum = budgetSummary(s)
  const v = budgetView(s, all)
  expect(sum?.source).toBe("overall")
  expect(sum?.count).toBe(1)
  expect(sum?.limit).toBe(50000)
  expect(sum?.spent).toBe(20965)
  expect(sum?.safePerDay).toBe(v.safePerDay)
  expect(sum?.daysLeft).toBe(v.daysLeft)
})
