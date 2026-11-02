// The gating rules behind the daily-loop rewards and misses: once a day,
// once per streak break, the milestone thresholds, only a step up in the
// day's standing, and the morning recap of yesterday.
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
  streakLost,
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

describe("streakLost", () => {
  const broken = [
    { day: "2026-10-20", length: 4 },
    { day: "2026-11-01", length: 12 },
  ]
  it("shows the streak that broke on yesterday's miss, for that day only", () => {
    expect(streakLost(broken, 0, "2026-11-02")).toBe(12)
    expect(streakLost(broken, 0, "2026-11-03")).toBe(0)
  })
  it("says nothing once the habit is done again today", () => {
    expect(streakLost(broken, 1, "2026-11-02")).toBe(0)
  })
  it("says nothing without a break yesterday", () => {
    expect(streakLost(broken, 0, "2026-10-25")).toBe(0)
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
  it("names an off-target yesterday and the streak it ended", () => {
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
      ended: 3,
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
