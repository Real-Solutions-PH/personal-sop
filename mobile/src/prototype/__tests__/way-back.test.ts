import type { Habit, HabitLog } from "@domain/habits/data"
import { logIndex, streaks } from "@domain/habits/logic"
import {
  lastActiveDay,
  shouldShowWayBack,
  wayBackGap,
  wayBackLines,
  wayBackPauses,
} from "@domain/way-back"

const habit = (id: string, extra: Partial<Habit> = {}): Habit => ({
  id,
  name: id === "g" ? "Gym" : "Read",
  icon: "✅",
  type: "check",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
  reminder: false,
  status: "active",
  pauses: [],
  linkWorkout: false,
  createdAt: "2026-10-01",
  sortOrder: 0,
  ...extra,
})
const done = (habitId: string, days: string[]): HabitLog[] =>
  days.map((day, i) => ({
    id: `${habitId}${i}`,
    habitId,
    day,
    status: "done",
    loggedAt: `${day}T08:00:00`,
    source: "tap",
  }))
const oct = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`,
  )

describe("lastActiveDay", () => {
  it("is the latest day before today with anything logged", () => {
    expect(
      lastActiveDay(["2026-10-10", "2026-10-19", "2026-10-12"], "2026-10-23"),
    ).toBe("2026-10-19")
  })
  it("ignores today and is null with no activity", () => {
    expect(lastActiveDay(["2026-10-23"], "2026-10-23")).toBeNull()
    expect(lastActiveDay([], "2026-10-23")).toBeNull()
  })
})

describe("wayBackGap", () => {
  it("is null for a fresh install with no activity", () => {
    expect(wayBackGap(null, "2026-10-23")).toBeNull()
  })
  it("is null for one empty day", () => {
    expect(wayBackGap("2026-10-21", "2026-10-23")).toBeNull()
  })
  it("covers the empty days after two or more", () => {
    expect(wayBackGap("2026-10-19", "2026-10-23")).toEqual({
      from: "2026-10-20",
      to: "2026-10-22",
      days: 3,
    })
  })
})

describe("shouldShowWayBack", () => {
  const gap = { from: "2026-10-20", to: "2026-10-22", days: 3 }
  it("shows once per last active day", () => {
    expect(shouldShowWayBack(gap, "", "2026-10-19")).toBe(true)
    expect(shouldShowWayBack(gap, "2026-10-19", "2026-10-19")).toBe(false)
    expect(shouldShowWayBack(null, "", "2026-10-19")).toBe(false)
  })
})

describe("wayBackPauses", () => {
  const gap = { from: "2026-10-20", to: "2026-10-22", days: 3 }
  const today = "2026-10-23"
  it("pauses every active habit across the gap", () => {
    const hs = [
      habit("g"),
      habit("r"),
      habit("old", { status: "archived", archivedAt: "2026-10-05" }),
    ]
    expect(wayBackPauses(hs, gap, today)).toEqual([
      { habitId: "g", from: "2026-10-20", to: "2026-10-22" },
      { habitId: "r", from: "2026-10-20", to: "2026-10-22" },
    ])
  })
  it("skips a habit already paused on the gap's last day", () => {
    const hs = [habit("g", { pauses: [{ from: "2026-10-15" }] })]
    expect(wayBackPauses(hs, gap, today)).toEqual([])
  })
  it("writes nothing when a way back paused within the last 30 days", () => {
    const hs = [
      habit("g", {
        pauses: [{ from: "2026-10-01", to: "2026-10-03", reason: "way_back" }],
      }),
      habit("r"),
    ]
    expect(wayBackPauses(hs, gap, today)).toEqual([])
  })
  it("allows one again after 30 days", () => {
    const hs = [
      habit("g", {
        pauses: [{ from: "2026-09-20", to: "2026-09-22", reason: "way_back" }],
      }),
    ]
    expect(wayBackPauses(hs, gap, today)).toHaveLength(1)
  })
  it("resumes the streak at its old length", () => {
    const logs = done("g", oct(8, 19))
    const paused = habit("g", {
      pauses: [{ from: "2026-10-20", to: "2026-10-22", reason: "way_back" }],
    })
    expect(streaks(paused, logIndex(logs), today).current).toBe(12)
    expect(streaks(habit("g"), logIndex(logs), today).current).toBe(0)
  })
  it("still counts a catch-up log on a gap day", () => {
    const logs = done("g", [...oct(8, 19), "2026-10-21"])
    const paused = habit("g", {
      pauses: [{ from: "2026-10-20", to: "2026-10-22", reason: "way_back" }],
    })
    expect(streaks(paused, logIndex(logs), today).current).toBe(13)
  })
})

describe("wayBackLines", () => {
  const gap = { from: "2026-10-20", to: "2026-10-22", days: 3 }
  const today = "2026-10-23"
  it("says the streak was paused, what is on today, and a win", () => {
    const g = habit("g", {
      pauses: [{ from: "2026-10-20", to: "2026-10-22", reason: "way_back" }],
    })
    const lines = wayBackLines({
      habits: [g],
      logs: done("g", oct(8, 19)),
      today,
      gap,
      due: { habits: 3, tasks: 2 },
      lastOnTarget: "2026-10-19",
    })
    expect(lines).toEqual([
      "Gym: 3 days missed · streak paused at 12",
      "Today: 3 habits and 2 tasks",
      "Your last on-target day was Monday",
    ])
  })
  it("says the run ended when no pause was written", () => {
    const lines = wayBackLines({
      habits: [habit("g")],
      logs: done("g", oct(8, 19)),
      today,
      gap,
      due: { habits: 1, tasks: 0 },
      lastOnTarget: null,
    })
    expect(lines[0]).toBe("Gym: 3 days missed · run of 12 ended")
    expect(lines[1]).toBe("Today: 1 habit and 0 tasks")
    expect(lines[2]).toBe("Best run so far: Gym, 12 days")
  })
})
