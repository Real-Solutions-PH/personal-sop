// Net worth against the line repeating income and bills alone draw: each
// repeating occurrence on its day, logged or not; one-offs, what-ifs and
// skipped days left out.
import { addDays, monthOf, monthRange } from "@domain/finance/calc"
import type { FinRecord, FinState, PlannedItem } from "@domain/finance/data"
import { expectedTrend } from "@domain/finance/forecast"
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
const from = addDays(today, -20)
const weekly = (
  id: string,
  type: PlannedItem["type"],
  amount: number,
  anchor: string,
  extra: Partial<PlannedItem> = {},
): PlannedItem => ({
  id,
  name: id,
  type,
  amount,
  estimated: false,
  accountId: "bank",
  schedule: { kind: "weekly", every: 1, anchor },
  start: anchor,
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
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
  accountId: "bank",
  at: `${day}T12:00:00`,
  source: "manual",
  status: "cleared",
  ...extra,
})
function state(planned: PlannedItem[], records: FinRecord[] = []): FinState {
  const s = finStore.get()
  const base = s.accounts[0]
  const acct = (id: string, extra: Partial<typeof base> = {}) => ({
    ...base,
    id,
    opening: 10000,
    openingDate: addDays(today, -400),
    inNetWorth: true,
    archived: false,
    ...extra,
  })
  return {
    ...s,
    records,
    accounts: [
      acct("bank"),
      acct("wallet"),
      acct("outside", { inNetWorth: false }),
      acct("old", { archived: true }),
    ],
    planned,
  }
}
// Net worth accounts: bank + wallet = 20,000 before any record.

test("salary and rent step the expected line on their days; day 0 starts from the actual", () => {
  const s = state(
    [
      weekly("pay", "income", 1000, addDays(from, 2)),
      weekly("rent", "expense", 400, from),
    ],
    [rec("coffee", "expense", 50, from)],
  )
  const e = expectedTrend(s, from, today)
  expect(e.actual[0]).toBe(19950)
  expect(e.expected[0]).toBe(19950 - 400)
  expect(e.expected[2] - e.expected[1]).toBe(1000)
  expect(e.expected[7] - e.expected[6]).toBe(-400)
  expect(e.hasRecurring).toBe(true)
})

test("one-off and what-if items are ignored", () => {
  const s = state([
    {
      ...weekly("once", "expense", 999, from),
      schedule: { kind: "once", date: addDays(from, 1) },
    },
    weekly("draft", "expense", 999, from, { isWhatIf: true }),
  ])
  const e = expectedTrend(s, from, today)
  expect(new Set(e.expected).size).toBe(1)
})

test("skipped occurrences are ignored", () => {
  const s = state([weekly("rent", "expense", 400, from, { skipped: [from] })])
  const e = expectedTrend(s, from, today)
  expect(e.expected[0]).toBe(20000)
  expect(e.expected[7]).toBe(19600)
})

test("a transfer between net worth accounts is 0; one leaving them subtracts", () => {
  const s = state([
    weekly("move", "transfer", 300, from, { toAccountId: "wallet" }),
    weekly("away", "transfer", 200, from, { toAccountId: "outside" }),
  ])
  const e = expectedTrend(s, from, today)
  expect(e.expected[0]).toBe(20000 - 200)
})

test("archived and excluded accounts stay out of the actual line", () => {
  const s = state(
    [],
    [
      rec("a", "expense", 70, from, { accountId: "outside" }),
      rec("b", "expense", 80, from, { accountId: "old" }),
    ],
  )
  expect(expectedTrend(s, from, today).actual[0]).toBe(20000)
})

test("the actual line stops at today; the gap is actual minus expected today", () => {
  const s = state(
    [weekly("pay", "income", 1000, from)],
    [rec("spend", "expense", 600, addDays(from, 3))],
  )
  const e = expectedTrend(s, from, addDays(today, 10))
  expect(e.days).toHaveLength(31)
  expect(e.actual).toHaveLength(21)
  expect(e.expected).toHaveLength(31)
  expect(e.gapToday).toBe(e.actual[20] - e.expected[20])
})

test("a range in the past has an actual point every day and no gap today", () => {
  const e = expectedTrend(state([]), addDays(today, -40), addDays(today, -10))
  expect(e.actual).toHaveLength(e.days.length)
  expect(e.gapToday).toBeNull()
})

test("with nothing repeating the expected line is flat at the start", () => {
  const e = expectedTrend(state([]), from, today)
  expect(e.hasRecurring).toBe(false)
  expect(new Set(e.expected)).toEqual(new Set([20000]))
})

test("a month starting on the 5th gives that month's day count", () => {
  const [f, t] = monthRange(monthOf(today, 5), 5)
  const e = expectedTrend(state([]), f, t)
  expect(e.days[0]).toBe(f)
  expect(e.days.at(-1)).toBe(t)
  expect(Number(f.slice(8))).toBe(5)
})
