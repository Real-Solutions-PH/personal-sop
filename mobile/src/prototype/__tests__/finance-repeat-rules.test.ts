// The phone's repeat rules land on the same dates as the server's
// (backend/tests/modules/finance/unit/test_recurrence.py holds the same
// grid): the 31st clamps to a month's last day, 29 February to the 28th,
// and every N months counts from the first date on or after the start.
// Expected dates are read off a calendar.
import {
  monthlyEq,
  nextOccurrence,
  occurrences,
  repeatLabel,
} from "@domain/finance/calc"
import type {
  EndRule,
  FinState,
  PlannedItem,
  Schedule,
} from "@domain/finance/data"

const plan = (
  schedule: Schedule,
  start: string,
  end: EndRule = { kind: "never" },
): PlannedItem => ({
  id: "p",
  name: "Bill",
  type: "expense",
  amount: 1200,
  estimated: false,
  accountId: "a",
  schedule,
  start,
  end,
  autoLog: true,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
})

const CASES: [string, Schedule, string, string, string[]][] = [
  [
    "monthly on the 31st clamps to each month's last day",
    { kind: "monthly", day: 31 },
    "2027-01-31",
    "2027-06-30",
    [
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
      "2027-05-31",
      "2027-06-30",
    ],
  ],
  [
    "the 30th in February is the 29th in a leap year",
    { kind: "monthly", day: 30 },
    "2028-01-30",
    "2028-03-31",
    ["2028-01-30", "2028-02-29", "2028-03-30"],
  ],
  [
    "every 2 months counts from the first day on or after the start",
    { kind: "monthly", day: 15, every: 2 },
    "2026-01-20",
    "2026-08-31",
    ["2026-02-15", "2026-04-15", "2026-06-15", "2026-08-15"],
  ],
  [
    "every 3 months on the 31st, clamped, across a year end",
    { kind: "monthly", day: 31, every: 3 },
    "2026-11-30",
    "2027-11-30",
    ["2026-11-30", "2027-02-28", "2027-05-31", "2027-08-31", "2027-11-30"],
  ],
  [
    "every 5 months across two year boundaries",
    { kind: "monthly", day: 15, every: 5 },
    "2026-10-15",
    "2028-06-30",
    ["2026-10-15", "2027-03-15", "2027-08-15", "2028-01-15", "2028-06-15"],
  ],
  [
    "yearly on 29 February is the 28th in common years",
    { kind: "yearly", month: 2, day: 29 },
    "2028-02-29",
    "2032-12-31",
    ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"],
  ],
  [
    "every 2 years from the first date on or after the start",
    { kind: "yearly", month: 3, day: 1, every: 2 },
    "2026-11-04",
    "2032-12-31",
    ["2027-03-01", "2029-03-01", "2031-03-01"],
  ],
  [
    "every 10 days from the start",
    { kind: "daily", every: 10 },
    "2026-12-25",
    "2027-01-31",
    ["2026-12-25", "2027-01-04", "2027-01-14", "2027-01-24"],
  ],
]

describe("repeat rules", () => {
  it.each(CASES)("%s", (_, schedule, start, last, expected) => {
    expect(occurrences(plan(schedule, start), start, last)).toEqual(expected)
  })

  it("ends after N times, counted from the start", () => {
    const p = plan({ kind: "monthly", day: 15, every: 3 }, "2026-11-01", {
      kind: "count",
      n: 3,
    })
    expect(occurrences(p, "2026-11-01", "2028-12-31")).toEqual([
      "2026-11-15",
      "2027-02-15",
      "2027-05-15",
    ])
  })

  it("reads in plain words", () => {
    expect(repeatLabel({ kind: "monthly", day: 15, every: 3 })).toBe(
      "Every 3 months on the 15th",
    )
    expect(repeatLabel({ kind: "monthly", day: 31 })).toBe(
      "Monthly on the last day",
    )
    expect(
      repeatLabel({ kind: "weekly", every: 2, anchor: "2026-11-06" }),
    ).toBe("Every 2 weeks on Friday")
    expect(repeatLabel({ kind: "yearly", month: 11, day: 4 })).toBe(
      "Yearly on 4 November",
    )
    expect(repeatLabel({ kind: "daily", every: 1 })).toBe("Daily")
  })

  it("converts to a monthly amount", () => {
    expect(
      monthlyEq(plan({ kind: "monthly", day: 1, every: 3 }, "2026-11-01")),
    ).toBe(400)
    expect(
      monthlyEq(plan({ kind: "yearly", month: 1, day: 1 }, "2026-11-01")),
    ).toBe(100)
  })

  it("names the next unpaid, unskipped date", () => {
    const p = {
      ...plan({ kind: "monthly", day: 15, every: 2 }, "2026-11-01"),
      skipped: ["2027-01-15"],
    }
    const s = {
      records: [{ id: "r", plannedId: "p", plannedOn: "2026-11-15" }],
    } as unknown as FinState
    expect(nextOccurrence(s, p, "2026-11-01")).toBe("2027-03-15")
  })
})

describe("a repeat follows its start date", () => {
  const { followStart, ruleFrom } =
    require("../finance-repeat") as typeof import("../finance-repeat")

  it("moves the day of the month and the weekly anchor with the start", () => {
    expect(
      followStart(
        ruleFrom("months", 3, "2026-11-04"),
        "2026-11-04",
        "2026-11-20",
      ),
    ).toEqual({ kind: "monthly", day: 20, every: 3 })
    expect(
      followStart(
        ruleFrom("weeks", 2, "2026-11-04"),
        "2026-11-04",
        "2026-11-06",
      ),
    ).toEqual({ kind: "weekly", every: 2, anchor: "2026-11-06" })
  })

  it("keeps 'the last day' only while the start is a month's last day", () => {
    const last = ruleFrom("months", 1, "2026-11-30", true)
    expect(last).toEqual({ kind: "monthly", day: 31, every: 1 })
    expect(followStart(last, "2026-11-30", "2027-02-28")).toEqual(last)
    expect(followStart(last, "2026-11-30", "2026-12-15")).toEqual({
      kind: "monthly",
      day: 15,
      every: 1,
    })
  })

  it("leaves a day the person chose apart from the start alone", () => {
    const rule = { kind: "monthly" as const, day: 5, every: 2 }
    expect(followStart(rule, "2026-11-04", "2026-11-20")).toBe(rule)
  })
})
