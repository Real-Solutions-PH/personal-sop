// What is scheduled ahead: every unpaid bill and income from today on
// (overdue ones counted as due today), their totals, and the balance on
// hand day by day with its lowest point.
import { addDays, outlook, scheduledFlow } from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
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
const once = (
  id: string,
  type: PlannedItem["type"],
  amount: number,
  day: string,
  extra: Partial<PlannedItem> = {},
): PlannedItem => ({
  id,
  name: id,
  type,
  amount,
  estimated: false,
  accountId: "wallet",
  schedule: { kind: "once", date: day },
  start: day,
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})

function state(planned: PlannedItem[]): FinState {
  const s = finStore.get()
  const base = s.accounts[0]
  return {
    ...s,
    records: [],
    accounts: [
      {
        ...base,
        id: "wallet",
        opening: 10000,
        openingDate: addDays(today, -30),
        inProjection: true,
        archived: false,
      },
    ],
    planned,
  }
}

test("bills and income ahead move the balance on their day; overdue counts today", () => {
  const s = state([
    once("rent", "expense", 8000, addDays(today, 3)),
    once("salary", "income", 20000, addDays(today, 5)),
    once("late bill", "expense", 1000, addDays(today, -2)),
    once("skipped", "expense", 500, addDays(today, 4), {
      skipped: [addDays(today, 4)],
    }),
  ])
  const o = outlook(s, addDays(today, 6))
  expect(o.start).toBe(10000)
  expect(o.items.map((x) => x.item.id)).toEqual(["late bill", "rent", "salary"])
  expect([o.toPay, o.comingIn]).toEqual([9000, 20000])
  // today: 10,000 − 1,000 overdue; day 3: − 8,000; day 5: + 20,000
  expect(o.days[0]).toEqual({ day: today, balance: 9000 })
  expect(o.days[3].balance).toBe(1000)
  expect(o.low).toEqual({ day: addDays(today, 3), value: 1000 })
  expect(o.end).toBe(21000)
  expect(scheduledFlow(s, addDays(today, 6))).toEqual({
    income: 20000,
    spend: 9000,
  })
})

test("an item left out of the projection is listed but leaves the line alone", () => {
  const s = state([
    once("maybe", "expense", 3000, addDays(today, 1), { inProjection: false }),
  ])
  const o = outlook(s, addDays(today, 2))
  expect(o.items).toHaveLength(1)
  expect(o.toPay).toBe(3000)
  expect(o.end).toBe(10000)
})
