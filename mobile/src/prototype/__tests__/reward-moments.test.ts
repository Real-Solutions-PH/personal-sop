// The gating behind the money, focus and stats moments: which budgets a
// save breaks, which savings goals it reaches, when a Life Score level is
// news, when tonight's "streak at risk" reminder is due, which focus sets
// ran their full length, and which goals ended a period unmet.

import type { Goal } from "@domain/dash/data"
import type { Account, Budget, FinRecord, FinState } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import type { FocusState } from "@domain/focus/data"
import { configureStorage, resetAll } from "@domain/lib/store"
import { budgetHits, goalsReached, hitLine, withDraft } from "../budget-alerts"
import { finishedSets, newlyFinished } from "../focus-live"
import { type GoalNote, missedGoals, noteGoals, periodOf } from "../goal-ledger"
import { AT_RISK_TIME, type AtRisk, atRiskPlan } from "../local-reminders"
import { claimOnce, levelStep, momentsSeen, noteLevel } from "../moments-seen"

// The set-end tap and chime are not under test here, and the motion module
// pulls in Reanimated.
jest.mock("../motion", () => ({ feel: { success: jest.fn() } }))
jest.mock("../chime", () => ({ chime: jest.fn() }))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.useFakeTimers()
  // Mid-month, so a budget's pace is 10/30 of the month gone.
  jest.setSystemTime(new Date(2026, 10, 10, 12))
})
afterEach(() => jest.useRealTimers())

const peso = (n: number) => `₱${n.toLocaleString("en-US")}`

const budget = (id: string, limit: number, cats: string[] | null): Budget => ({
  id,
  name: id,
  categoryIds: cats,
  period: "monthly",
  limit,
  rollover: false,
  startDate: "2020-01-01",
  archived: false,
})
const spend = (
  id: string,
  amount: number,
  categoryId = "food",
  day = "2026-11-10",
): FinRecord => ({
  id,
  type: "expense",
  amount,
  accountId: "wallet",
  categoryId,
  at: new Date(`${day}T12:00:00`).toISOString(),
  source: "manual",
  status: "cleared",
})
function fin(budgets: Budget[], records: FinRecord[]): FinState {
  const s = finStore.get()
  return {
    ...s,
    budgets,
    records,
    settings: { ...s.settings, monthStartDay: 1 },
    categories: [
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
        discretionary: false,
        archived: false,
      },
    ],
  } as FinState
}

describe("budgetHits", () => {
  const food = budget("Food", 5000, ["food"])

  it("names a budget the save pushes over, with how far", () => {
    const before = fin([food], [spend("a", 4800)])
    const after = withDraft(before, spend("b", 620))
    const hits = budgetHits(before, after, "2026-11-10")
    expect(hits).toEqual([
      { id: "Food", name: "Food", kind: "over", over: 420, was: false },
    ])
    expect(hitLine(hits[0], peso)).toBe("Food budget now over by ₱420")
    expect(hitLine(hits[0], peso, false)).toBe(
      "Saving this puts Food budget over by ₱420",
    )
  })

  it("still warns when a budget already over goes further over", () => {
    const before = fin([food], [spend("a", 5200)])
    const after = withDraft(before, spend("b", 100))
    expect(budgetHits(before, after, "2026-11-10")).toEqual([
      expect.objectContaining({ kind: "over", over: 300, was: true }),
    ])
  })

  it("says ahead of pace once a save first passes it", () => {
    // 10 of 30 days gone: pace is a third, ahead past 38%.
    const before = fin([food], [spend("a", 1500)])
    const after = withDraft(before, spend("b", 1000))
    const [hit] = budgetHits(before, after, "2026-11-10")
    expect(hit).toEqual(
      expect.objectContaining({ kind: "pace", spent: 2500, limit: 5000 }),
    )
    // Already ahead before: no second warning for the same state.
    const later = withDraft(after, spend("c", 100))
    expect(budgetHits(after, later, "2026-11-10")).toEqual([])
  })

  it("leaves out budgets the record does not touch", () => {
    const before = fin([food], [spend("a", 4900)])
    const after = withDraft(before, spend("b", 900, "gym"))
    expect(budgetHits(before, after, "2026-11-10")).toEqual([])
  })

  it("judges the record's own month, not this one", () => {
    const before = fin([food], [spend("a", 4900, "food", "2026-10-15")])
    const after = withDraft(before, spend("b", 200, "food", "2026-10-20"))
    expect(budgetHits(before, after, "2026-10-20")).toEqual([
      expect.objectContaining({ kind: "over", over: 100 }),
    ])
    expect(budgetHits(before, after, "2026-11-10")).toEqual([])
  })

  it("an edit that lowers the amount is never a hit", () => {
    const before = fin([food], [spend("a", 5600)])
    const after = withDraft(before, spend("a", 4000), "a")
    expect(budgetHits(before, after, "2026-11-10")).toEqual([])
  })
})

describe("goalsReached", () => {
  const savings = {
    id: "save",
    name: "Emergency fund",
    type: "savings",
    opening: 9000,
    goal: 10000,
    archived: false,
  } as unknown as Account
  const s0 = { ...fin([], []), accounts: [savings] } as FinState
  const transfer = (amount: number): FinRecord => ({
    id: `t${amount}`,
    type: "transfer",
    amount,
    accountId: "wallet",
    toAccountId: "save",
    at: new Date().toISOString(),
    source: "manual",
    status: "cleared",
  })

  it("reports the goal the save crosses", () => {
    const after = withDraft(s0, transfer(1000))
    expect(goalsReached(s0, after).map((a) => a.id)).toEqual(["save"])
  })
  it("says nothing short of it, or once already past it", () => {
    expect(goalsReached(s0, withDraft(s0, transfer(999)))).toEqual([])
    const past = withDraft(s0, transfer(1500))
    expect(goalsReached(past, withDraft(past, transfer(100)))).toEqual([])
  })
})

describe("level gating", () => {
  it("treats the first level seen as a baseline", () => {
    expect(levelStep(-1, 3, [])).toEqual({ kind: "none" })
  })
  it("cheers a level reached for the first time", () => {
    expect(levelStep(2, 3, [])).toEqual({ kind: "up", key: "level-up:3" })
  })
  it("never cheers the same level twice", () => {
    expect(levelStep(2, 3, ["level-up:3"])).toEqual({ kind: "none" })
  })
  it("calls a drop a drop", () => {
    expect(levelStep(3, 2, ["level-up:3"])).toEqual({ kind: "down" })
  })
  it("persists: down then back up shows the note once and no pop-up", () => {
    const names = ["A", "B", "C", "D"]
    expect(noteLevel(1, names).kind).toBe("none")
    expect(noteLevel(2, names).kind).toBe("up")
    expect(noteLevel(2, names).kind).toBe("none")
    expect(noteLevel(1, names).kind).toBe("down")
    expect(momentsSeen.get().drop).toEqual({ from: "C", to: "B" })
    // Back to C: already reached once, so no second pop-up; the drop note
    // stays until it is dismissed.
    expect(noteLevel(2, names).kind).toBe("none")
    expect(noteLevel(3, names).kind).toBe("up")
    expect(momentsSeen.get().drop).toEqual({ from: "", to: "" })
  })
  it("claimOnce is true only the first time", () => {
    expect(claimOnce("budget-month:2026-10")).toBe(true)
    expect(claimOnce("budget-month:2026-10")).toBe(false)
  })
})

describe("atRiskPlan", () => {
  const base: AtRisk = {
    due: 8,
    done: 3,
    threshold: 0.8,
    streak: 5,
    evening: "21:00",
  }
  const afternoon = new Date(2026, 10, 10, 15)

  it("plans 20:30 tonight while below target with a streak to lose", () => {
    const p = atRiskPlan(base, afternoon)
    expect(p?.at).toEqual(
      new Date(2026, 10, 10, AT_RISK_TIME.hour, AT_RISK_TIME.minute),
    )
    expect(p?.title).toBe("🔥 Your 5-day streak is at risk")
    // 80% of 8 is 6.4: 7 done keeps it, so 4 more.
    expect(p?.body).toBe("3 of 8 done today. 4 more keep it going.")
  })
  it("is off with no streak, at or over target, or nothing due", () => {
    expect(atRiskPlan({ ...base, streak: 0 }, afternoon)).toBeNull()
    expect(atRiskPlan({ ...base, done: 7 }, afternoon)).toBeNull()
    expect(atRiskPlan({ ...base, due: 0, done: 0 }, afternoon)).toBeNull()
  })
  it("respects evening pushes off, quiet hours and the hour passed", () => {
    expect(atRiskPlan({ ...base, evening: "" }, afternoon)).toBeNull()
    expect(
      atRiskPlan(
        { ...base, quiet: { start: "20:00", end: "07:00" } },
        afternoon,
      ),
    ).toBeNull()
    expect(atRiskPlan(base, new Date(2026, 10, 10, 20, 31))).toBeNull()
  })
  it("a threshold met exactly is on target", () => {
    expect(
      atRiskPlan({ ...base, due: 10, done: 8, threshold: 0.8 }, afternoon),
    ).toBeNull()
  })
})

describe("finishedSets", () => {
  const now = new Date(2026, 10, 10, 12).getTime()
  const iso = (min: number) => new Date(now + min * 60_000).toISOString()
  const focus = {
    sessions: [{ id: "s", startedAt: iso(-60) }],
    segments: [
      // Set 0: 25 min split by a pause, all of it done.
      {
        id: "a",
        sessionId: "s",
        kind: "focus",
        setIndex: 0,
        startedAt: iso(-60),
        endedAt: iso(-50),
        plannedSec: 1500,
      },
      {
        id: "b",
        sessionId: "s",
        kind: "focus",
        setIndex: 0,
        startedAt: iso(-45),
        endedAt: iso(-30),
        plannedSec: 1500,
      },
      // Set 1: stopped after 5 of 25 minutes.
      {
        id: "c",
        sessionId: "s",
        kind: "focus",
        setIndex: 1,
        startedAt: iso(-25),
        endedAt: iso(-20),
        plannedSec: 1500,
      },
    ],
  } as unknown as FocusState

  it("counts only sets that ran their planned length", () => {
    expect([...finishedSets(focus, now)]).toEqual(["s:0"])
  })
  it("reports what is new since the last look", () => {
    expect(newlyFinished(new Set(), new Set(["s:0"]))).toEqual(["s:0"])
    expect(newlyFinished(new Set(["s:0"]), new Set(["s:0"]))).toEqual([])
  })
})

describe("goal periods", () => {
  const goal = (id: string, period: Goal["period"]): Goal => ({
    id,
    metric: "life",
    label: "Sleep",
    target: 7,
    unit: "h",
    comparator: "gte",
    period,
    createdAt: "2026-10-01T00:00:00Z",
    status: "active",
  })
  const sleep = goal("sleep", "week")

  it("keys weeks by their Monday and months by YYYY-MM", () => {
    expect(periodOf("2026-11-08", "week")).toBe("2026-11-02") // a Sunday
    expect(periodOf("2026-11-09", "week")).toBe("2026-11-09") // a Monday
    expect(periodOf("2026-11-09", "month")).toBe("2026-11")
  })

  it("names last week's goal missed from a note near its end", () => {
    const notes = noteGoals(
      [],
      [{ goal: sleep, entry: { value: "6.4h", n: 6.4 }, hit: false }],
      "2026-11-08",
    )
    expect(missedGoals(notes, [sleep], "2026-11-10")).toEqual([
      { goal: sleep, period: "2026-11-02", value: "6.4h" },
    ])
  })

  it("says nothing when the week was met, or seen only early on", () => {
    const met: GoalNote[] = [
      {
        goalId: "sleep",
        period: "2026-11-02",
        day: "2026-11-08",
        value: "7.2h",
        hit: true,
      },
    ]
    expect(missedGoals(met, [sleep], "2026-11-10")).toEqual([])
    const early = [{ ...met[0], day: "2026-11-04", hit: false }]
    expect(missedGoals(early, [sleep], "2026-11-10")).toEqual([])
  })

  it("a goal set after the period ended had nothing to miss", () => {
    const late = { ...sleep, createdAt: "2026-11-09T00:00:00Z" }
    const notes: GoalNote[] = [
      {
        goalId: "sleep",
        period: "2026-11-02",
        day: "2026-11-08",
        value: "6h",
        hit: false,
      },
    ]
    expect(missedGoals(notes, [late], "2026-11-10")).toEqual([])
  })

  it("a month goal reads last month", () => {
    const month = goal("m", "month")
    const notes: GoalNote[] = [
      {
        goalId: "m",
        period: "2026-10",
        day: "2026-10-30",
        value: "6h",
        hit: false,
      },
    ]
    expect(missedGoals(notes, [month], "2026-11-10")).toEqual([
      { goal: month, period: "2026-10", value: "6h" },
    ])
  })
})
