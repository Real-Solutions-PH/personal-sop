// The demo seed stamps every routine run and habit log on its own business
// day, and no seeded run reads as a fresh finish. Between midnight and the
// 04:00 day start the calendar is a day ahead; a seed stamped by the
// calendar put yesterday's evening routine a few hours ago, where Today's
// finish watcher took it for a fresh finish and covered the screen, and
// every test that renders the watcher failed, but only between midnight and
// about 04:45 on the machine running them.

import { seedHabits } from "@domain/habits/data"
import { dayKey } from "@domain/lib/day"

const HOURS = ["00:10", "01:30", "03:59", "04:00", "04:30", "09:00", "23:30"]
const SIX_HOURS = 6 * 60 * 60 * 1000

afterEach(() => jest.useRealTimers())

describe.each(HOURS)("seeded at %s local", (hm) => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(`2026-11-03T${hm}:00`) })
  })

  test("every run and log falls on its own business day", () => {
    const s = seedHabits()
    expect(s.runs.length).toBeGreaterThan(0)
    for (const r of s.runs) expect(dayKey(new Date(r.startedAt))).toBe(r.day)
    for (const l of s.logs) expect(dayKey(new Date(l.loggedAt))).toBe(l.day)
  })

  test("no seeded run reads as a fresh finish", () => {
    const now = Date.now()
    const fresh = seedHabits().runs.filter(
      (r) =>
        r.state === "completed" &&
        r.endedAt &&
        now - new Date(r.endedAt).getTime() < SIX_HOURS,
    )
    expect(fresh).toEqual([])
  })
})
