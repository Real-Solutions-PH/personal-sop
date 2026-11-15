// "Even after paying this recurring expense, it keeps on coming back."
// A monthly bill with no live account ("No account"), due 3 Nov, shows
// "3 days late" on Fri 6 Nov. Every way the app offers to pay it must take
// it off the overdue list and leave the next date a month on (3 Dec).
// Before the fix only the scheduled payment's own Pay / Record button did:
// the same payment logged from the + sheet, Apple Pay, a widget or Fern
// was a plain record nothing linked to the bill, so the bill stayed
// overdue while "Spent today" counted the payment.
// Days are read off a November 2026 calendar; instants are local wall-clock
// times, so the file holds in any zone the runner uses.

import {
  addRecord,
  logExpense,
  logIncome,
  logRecord,
  settleOccurrence,
} from "@domain/finance/actions"
import { dueFor, nextOccurrence, upcomingWeek } from "@domain/finance/calc"
import type { FinState, PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { derivedId } from "@domain/lib/ids"
import { configureStorage, resetAll } from "@domain/lib/store"

/** 10:00 local on Fri 6 Nov 2026. */
const NOW = new Date(2026, 10, 6, 10, 0)
const DUE = "2026-11-03"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
})
afterEach(() => jest.useRealTimers())

const gym = (extra: Partial<PlannedItem> = {}): PlannedItem => ({
  id: "gym",
  name: "Gym membership",
  type: "expense",
  amount: 1000,
  estimated: false,
  // The account it was planned on is gone: the row reads "No account".
  accountId: "closed-account",
  categoryId: "health",
  schedule: { kind: "monthly", day: 3 },
  start: "2026-08-03",
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})

function setup(planned: PlannedItem[] = [gym()]): FinState {
  const s = finStore.get()
  const next: FinState = {
    ...s,
    records: [],
    accounts: [{ ...s.accounts[0], id: "wallet", name: "GCash" }],
    planned,
  }
  finStore.set(next)
  return next
}
const overdue = () =>
  upcomingWeek(finStore.get()).overdue.map((o) => `${o.item.id}@${o.orig}`)
const next = () => {
  const s = finStore.get()
  const p = s.planned.find((x) => x.id === "gym")
  return p && nextOccurrence(s, p, "2026-11-01")
}
const at = (d: number, h: number, m = 0) =>
  new Date(2026, 10, d, h, m).toISOString()

test("before paying: the bill is 3 days late", () => {
  setup()
  expect(overdue()).toEqual([`gym@${DUE}`])
  expect(next()).toBe(DUE)
})

describe("every way to pay it takes it off the overdue list", () => {
  test("the scheduled payment's own Pay / Record button", () => {
    setup()
    settleOccurrence("gym", DUE, { amount: 1000, accountId: "wallet" })
    expect(overdue()).toEqual([])
    expect(next()).toBe("2026-12-03")
  })

  test("an expense logged from the + sheet under the bill's name", () => {
    setup()
    const r = logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      categoryId: "health",
      payee: "Gym membership",
      at: at(6, 9, 30),
    })
    expect(r).toMatchObject({ plannedId: "gym", plannedOn: DUE })
    // The id the server derives when it settles, so the sync sends a
    // finance.settle and both sides hold one record for the date.
    expect(r.id).toBe(derivedId("planned-record", "gym", DUE))
    expect(overdue()).toEqual([])
    expect(next()).toBe("2026-12-03")
  })

  test('a shorter name for it ("gym") pays it', () => {
    setup()
    logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      categoryId: "fitness",
      payee: "gym",
      at: at(6, 9, 30),
    })
    expect(overdue()).toEqual([])
  })

  test("no payee: the bill's category and its exact amount pay it", () => {
    setup()
    logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      categoryId: "health",
      at: at(6, 9, 30),
    })
    expect(overdue()).toEqual([])
    expect(next()).toBe("2026-12-03")
  })

  test("Fern / Apple Pay / a widget (logExpense) pays it", () => {
    setup()
    logExpense({ amount: 1000, payee: "Gym Membership", accountId: "wallet" })
    expect(overdue()).toEqual([])
    expect(next()).toBe("2026-12-03")
  })

  test("paid just after midnight, before the 04:00 rollover, still pays it", () => {
    setup()
    // 02:30 on Sat 7 Nov is still Fri 6 Nov's business day.
    logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(7, 2, 30),
    })
    expect(finStore.get().records[0]).toMatchObject({ plannedOn: DUE })
  })

  test("the overdue date is paid, never the next month's", () => {
    setup()
    // Two weeks of grace each side: 3 Nov is overdue, 3 Dec far off.
    logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(6, 9),
    })
    const r = finStore.get().records[0]
    expect(r.plannedOn).toBe(DUE)
    // A second payment the same day has nothing left to pay.
    const again = logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(6, 11),
    })
    expect(again.plannedId).toBeUndefined()
  })

  test("an income paid in under the expected name settles it", () => {
    setup([
      gym({
        id: "salary",
        name: "Salary",
        type: "income",
        amount: 50000,
        categoryId: "salary",
        schedule: { kind: "monthly", day: 5 },
      }),
    ])
    logIncome({ amount: 50000, payee: "salary", accountId: "wallet" })
    expect(upcomingWeek(finStore.get()).overdue).toEqual([])
  })
})

describe("what does not pay it", () => {
  test("another expense on the same day", () => {
    setup()
    logRecord({
      type: "expense",
      amount: 150,
      accountId: "wallet",
      categoryId: "coffee",
      payee: "Coffee",
      at: at(6, 9),
    })
    expect(overdue()).toEqual([`gym@${DUE}`])
  })

  test("a small spend at the gym (the name, far from the amount)", () => {
    setup()
    logRecord({
      type: "expense",
      amount: 120,
      accountId: "wallet",
      payee: "Gym",
      at: at(6, 9),
    })
    expect(overdue()).toEqual([`gym@${DUE}`])
  })

  test("the category alone, at another amount", () => {
    setup()
    logRecord({
      type: "expense",
      amount: 700,
      accountId: "wallet",
      categoryId: "health",
      at: at(6, 9),
    })
    expect(overdue()).toEqual([`gym@${DUE}`])
  })

  test("income under the bill's name, a skipped date, a paused bill", () => {
    setup()
    logRecord({
      type: "income",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(6, 9),
    })
    expect(overdue()).toEqual([`gym@${DUE}`])
    setup([gym({ skipped: [DUE] }), gym({ id: "paused", archived: true })])
    const r = logRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(6, 9),
    })
    expect(r.plannedId).toBeUndefined()
  })

  test("a plain addRecord (duplicate, adjustment) is never linked", () => {
    setup()
    addRecord({
      type: "expense",
      amount: 1000,
      accountId: "wallet",
      payee: "Gym membership",
      at: at(6, 9),
    })
    expect(overdue()).toEqual([`gym@${DUE}`])
  })
})

test("dueFor prefers the name over the category, then the oldest date", () => {
  const s = setup([
    gym(),
    gym({
      id: "older",
      name: "Gym membership",
      schedule: { kind: "monthly", day: 1 },
    }),
    gym({ id: "physio", name: "Physio", categoryId: "health" }),
  ])
  const o = dueFor(s, {
    type: "expense",
    amount: 1000,
    accountId: "wallet",
    categoryId: "health",
    payee: "Gym membership",
    at: at(6, 9),
  })
  expect(o && `${o.item.id}@${o.orig}`).toBe("older@2026-11-01")
})
