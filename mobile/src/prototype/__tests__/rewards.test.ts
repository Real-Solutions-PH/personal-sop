// The gating rules behind the daily-loop rewards and misses: once a day,
// once per streak break, the milestone thresholds, only a step up in the
// day's standing, and the morning recap of yesterday.
import type { Habit, HabitLog, PauseRange } from "@domain/habits/data"
import { addDays, logIndex, streaks } from "@domain/habits/logic"
import { GRACE_GAP_DAYS, graceReady, walkRun } from "@domain/lib/grace"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  causedHere,
  claimDay,
  dayStanding,
  firstWeek,
  isMilestone,
  MILESTONES,
  playedToday,
  rewardStore,
  standingMoment,
  streakMiss,
  streakNote,
  yesterdayRecap,
} from "../rewards"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  rewardStore.set({ days: {} })
})

describe("claimDay", () => {
  it("plays once a day per key, and again the next day", () => {
    expect(claimDay("target", "2026-11-02")).toBe(true)
    expect(claimDay("target", "2026-11-02")).toBe(false)
    expect(playedToday("target", "2026-11-02")).toBe(true)
    // Another moment the same day is its own claim.
    expect(claimDay("perfect", "2026-11-02")).toBe(true)
    expect(claimDay("target", "2026-11-03")).toBe(true)
  })
})

const habit = (pauses: PauseRange[] = []): Habit => ({
  id: "h",
  name: "Gym",
  icon: "✅",
  type: "check",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  reminder: false,
  status: "active",
  pauses,
  linkWorkout: false,
  createdAt: "2026-10-01",
  sortOrder: 0,
})
const done = (...days: string[]): HabitLog[] =>
  days.map((day, i) => ({
    id: `l${i}`,
    habitId: "h",
    day,
    status: "done",
    loggedAt: `${day}T08:00:00`,
    source: "tap",
  }))
const run = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`,
  )
const at = (h: Habit, logs: HabitLog[], today: string) => {
  const idx = logIndex(logs)
  return { h, idx, st: streaks(h, idx, today), today }
}

describe("streakMiss", () => {
  it("shows the missed days and the run that ended yesterday", () => {
    // 12 done (10-08..10-19), missed 10-20 and 10-21; today 10-22.
    const c = at(habit(), done(...run(8, 19)), "2026-10-22")
    expect(streakMiss(c.h, c.idx, c.st, c.today)).toEqual({
      missed: 2,
      run: 12,
    })
  })
  it("is gone the day after", () => {
    const c = at(habit(), done(...run(8, 19)), "2026-10-23")
    expect(streakMiss(c.h, c.idx, c.st, c.today)).toBeNull()
  })
  it("says nothing once the habit is done again today", () => {
    const c = at(habit(), done(...run(8, 19), "2026-10-22"), "2026-10-22")
    expect(streakMiss(c.h, c.idx, c.st, c.today)).toBeNull()
  })
  it("says nothing while a grace day holds the run", () => {
    const c = at(habit(), done(...run(8, 20)), "2026-10-22")
    expect(c.st.current).toBe(13)
    expect(streakMiss(c.h, c.idx, c.st, c.today)).toBeNull()
  })
})

describe("streakNote", () => {
  it("says the rest day was used this week", () => {
    // Done 10-08..10-20, 10-21 missed and bridged: the rest day is spent.
    const c = at(habit(), done(...run(8, 20)), "2026-10-22")
    expect(streakNote(c.h, c.idx, c.st, c.today)).toBe("rest day used")
  })
  it("says a rest day is ready again once the gap has passed", () => {
    // Missed 10-14 (bridged), done every day since; 7 days later it's back.
    const logs = done(...run(8, 13), ...run(15, 21))
    const used = at(habit(), logs, "2026-10-20")
    expect(streakNote(used.h, used.idx, used.st, used.today)).toBe(
      "rest day used",
    )
    const back = at(habit(), logs, addDays("2026-10-14", GRACE_GAP_DAYS))
    expect(streakNote(back.h, back.idx, back.st, back.today)).toBe(
      "rest day ready",
    )
  })
  it("says the streak was paused while away, until the next done day", () => {
    const away = habit([
      { from: "2026-10-20", to: "2026-10-22", reason: "way_back" },
    ])
    const c = at(away, done(...run(8, 19)), "2026-10-23")
    expect(c.st.current).toBe(12)
    expect(streakNote(c.h, c.idx, c.st, c.today)).toBe("paused 3 days")
    // Done again: the pause note gives way to the rest-day status.
    const after = at(away, done(...run(8, 19), "2026-10-23"), "2026-10-24")
    expect(streakNote(after.h, after.idx, after.st, after.today)).toBe(
      "rest day ready",
    )
  })
  it("says a rest day is ready on a plain run", () => {
    const c = at(habit(), done(...run(8, 21)), "2026-10-22")
    expect(streakNote(c.h, c.idx, c.st, c.today)).toBe("rest day ready")
  })
  it("says nothing without a run", () => {
    const c = at(habit(), [], "2026-10-22")
    expect(streakNote(c.h, c.idx, c.st, c.today)).toBeNull()
  })
})

describe("graceReady against the walk", () => {
  // Every 7-day pattern of hit / miss / neutral: "ready" exactly when a
  // miss today and a hit tomorrow keep the run going.
  const start = "2026-11-01"
  const today = addDays(start, 7)
  const walk = (hits: (boolean | null)[]) =>
    walkRun(
      hits.map((h, i) => [addDays(start, i), h] as [string, boolean | null]),
    )
  const values = [true, false, null] as const
  const patterns: (boolean | null)[][] = [[]]
  for (let i = 0; i < 7; i++)
    patterns.splice(
      0,
      patterns.length,
      ...patterns.flatMap((p) => values.map((v) => [...p, v])),
    )
  it("agrees on all 2187 patterns", () => {
    expect(patterns.length).toBe(2187)
    let ready = 0
    for (const p of patterns) {
      const w = walk(p)
      const r = graceReady(w.current, w.graceDays, today)
      const after = walk([...p, false, true])
      if (w.current === 0) expect(r).toBe(false)
      else expect(after.current === w.current + 1).toBe(r)
      if (r) ready++
    }
    expect(ready).toBeGreaterThan(0)
  })
})

describe("milestones", () => {
  it("are 7, 30, 100 and 365 days, and nothing in between", () => {
    expect([...MILESTONES]).toEqual([7, 30, 100, 365])
    for (const n of [7, 30, 100, 365]) expect(isMilestone(n)).toBe(true)
    for (const n of [0, 1, 6, 8, 29, 31, 99, 101, 364, 366])
      expect(isMilestone(n)).toBe(false)
  })
})

describe("day standing", () => {
  it("reads free, below, target and perfect against the threshold", () => {
    expect(dayStanding({ due: 0, done: 0 }, 0.8)).toBe("free")
    expect(dayStanding({ due: 10, done: 7 }, 0.8)).toBe("below")
    expect(dayStanding({ due: 10, done: 8 }, 0.8)).toBe("target")
    expect(dayStanding({ due: 10, done: 10 }, 0.8)).toBe("perfect")
  })
  it("earns a moment only on a step up", () => {
    expect(standingMoment("below", "target")).toBe("target")
    expect(standingMoment("target", "perfect")).toBe("perfect")
    // Straight past the target to everything done: one, the bigger one.
    expect(standingMoment("below", "perfect")).toBe("perfect")
    expect(standingMoment("target", "target")).toBeNull()
    expect(standingMoment("perfect", "target")).toBeNull()
    expect(standingMoment("free", "below")).toBeNull()
  })
})

describe("yesterdayRecap", () => {
  const day = (d: string, onTarget: boolean | null) => ({ day: d, onTarget })
  it("says a lone off-target yesterday was covered by the grace day", () => {
    const series = [
      day("2026-10-27", false),
      day("2026-10-28", true),
      day("2026-10-29", true),
      day("2026-10-30", null),
      day("2026-10-31", true),
      day("2026-11-01", false),
      day("2026-11-02", null),
    ]
    expect(yesterdayRecap(series, "2026-11-02")).toEqual({
      offTarget: true,
      ended: 0,
      grace: true,
    })
  })
  it("names the run a second miss in a row ended", () => {
    const series = [
      day("2026-10-28", true),
      day("2026-10-29", true),
      day("2026-10-30", true),
      day("2026-10-31", false),
      day("2026-11-01", false),
    ]
    expect(yesterdayRecap(series, "2026-11-02")).toEqual({
      offTarget: true,
      ended: 3,
      grace: false,
    })
  })
  it("has nothing to say after an on-target or free yesterday", () => {
    expect(
      yesterdayRecap([day("2026-11-01", true)], "2026-11-02").offTarget,
    ).toBe(false)
    expect(
      yesterdayRecap([day("2026-11-01", null)], "2026-11-02").offTarget,
    ).toBe(false)
  })
})

describe("firstWeek", () => {
  it("tracks days 1 to 7 from the first log, then goes away", () => {
    const logs = ["2026-11-01", "2026-11-03"]
    const week = firstWeek(logs, "2026-11-03")
    expect(week.map((d) => d.logged)).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      false,
    ])
    expect(firstWeek(logs, "2026-11-07")).toHaveLength(7)
    expect(firstWeek(logs, "2026-11-08")).toEqual([])
  })
  it("before the first log, today is day 1, unlit", () => {
    const week = firstWeek([], "2026-11-03")
    expect(week[0]).toEqual({ day: "2026-11-03", logged: false })
    expect(week).toHaveLength(7)
  })
})

describe("causedHere", () => {
  const now = Date.parse("2026-11-03T08:00:10Z")
  it("a completion by hand just now counts", () => {
    expect(causedHere(500, undefined, 4000, now)).toBe(true)
  })
  it("a widget log written here seconds ago counts", () => {
    expect(causedHere(60_000, "2026-11-03T08:00:08Z", 4000, now)).toBe(true)
  })
  it("a pulled log from minutes ago does not", () => {
    expect(causedHere(60_000, "2026-11-03T07:55:00Z", 4000, now)).toBe(false)
    expect(causedHere(60_000, undefined, 4000, now)).toBe(false)
  })
  it("a log stamped in the future (another clock) does not", () => {
    expect(causedHere(60_000, "2026-11-03T08:01:00Z", 4000, now)).toBe(false)
  })
})
