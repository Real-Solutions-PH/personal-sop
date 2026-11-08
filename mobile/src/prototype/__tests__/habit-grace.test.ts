import type { Habit, HabitLog } from "@domain/habits/data"
import { logIndex, streaks } from "@domain/habits/logic"

const TODAY = "2026-11-08"
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

const habit = (days = EVERY_DAY, id = "h1"): Habit => ({
  id,
  name: "Gym",
  icon: "✅",
  type: "check",
  schedule: [{ days }],
  reminder: false,
  status: "active",
  pauses: [],
  linkWorkout: false,
  createdAt: "2026-10-20",
  sortOrder: 0,
})

const logs = (habitId: string, days: string[]): HabitLog[] =>
  days.map((day, i) => ({
    id: `${habitId}-${i}`,
    habitId,
    day,
    status: "done",
    loggedAt: `${day}T08:00:00`,
    source: "tap",
  }))

const nov = (...d: number[]) =>
  d.map((n) => `2026-11-${String(n).padStart(2, "0")}`)

const run = (h: Habit, done: string[]) =>
  streaks(h, logIndex(logs(h.id, done)), TODAY)

describe("grace day", () => {
  it("bridges one lone miss without counting it", () => {
    const s = run(habit(EVERY_DAY, "a"), nov(1, 2, 3, 4, 6, 7, 8))
    expect(s.current).toBe(7)
    expect(s.graceDays).toEqual(["2026-11-05"])
  })

  it("breaks on two misses in a row", () => {
    const s = run(habit(EVERY_DAY, "b"), nov(1, 2, 3, 4, 7, 8))
    expect(s.current).toBe(2)
    expect(s.graceDays).toEqual([])
  })

  it("breaks on a second lone miss within 7 days of the first", () => {
    const s = run(habit(EVERY_DAY, "c"), nov(1, 2, 4, 5, 7, 8))
    expect(s.current).toBe(2)
    expect(s.graceDays).toEqual([])
  })

  it("allows a second grace 7 or more days after the first", () => {
    // Misses on 10-27 and 11-03, exactly 7 days apart.
    const s = run(habit(EVERY_DAY, "d"), [
      "2026-10-25",
      "2026-10-26",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      ...nov(1, 2, 4, 5, 6, 7, 8),
    ])
    expect(s.current).toBe(13)
    expect(s.graceDays).toEqual(["2026-10-27", "2026-11-03"])
  })

  it("holds a grace for a miss yesterday while today is pending", () => {
    const s = run(habit(EVERY_DAY, "e"), nov(1, 2, 3, 4, 5, 6))
    expect(s.current).toBe(6)
    expect(s.graceDays).toEqual(["2026-11-07"])
  })

  it("keeps unscheduled days neutral on a 3-days-a-week habit", () => {
    // Mon/Wed/Fri: Nov 2, 4, 6 are Mon/Wed/Fri; miss Wed Nov 4.
    const s = run(habit([1, 3, 5], "f"), ["2026-10-30", ...nov(2, 6)])
    expect(s.current).toBe(3)
    expect(s.graceDays).toEqual(["2026-11-04"])
  })

  it("counts the bridged run in best, and records no break", () => {
    const s = run(habit(EVERY_DAY, "g"), nov(1, 2, 3, 4, 6, 7, 8))
    expect(s.best).toBe(7)
    expect(s.broken).toEqual([])
  })
})
