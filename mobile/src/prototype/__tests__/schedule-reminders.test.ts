// Reminders for items moved on the Plan tab: the moved day fires at the
// moved time, every other day keeps the item's own time.

import type { Habit, Routine } from "@domain/habits/data"
import type { ScheduleOverride } from "@domain/schedule/data"
import type { Task } from "@domain/tasks/data"
import { type Planned, planReminders } from "../local-reminders"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

// Thursday 2026-10-22, 08:00 in Manila (the test runner's zone is not
// assumed: every expectation is built with the same local Date maths).
const NOW = new Date(2026, 9, 22, 8, 0)
const TODAY = "2026-10-22"
const THU = 4
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m)

const habit = (extra: Partial<Habit> = {}) =>
  ({
    id: "h1",
    name: "Read",
    icon: "📖",
    type: "check",
    reminder: true,
    status: "active",
    pauses: [],
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" }],
    ...extra,
  }) as Habit
const moved = (
  kind: ScheduleOverride["kind"],
  refId: string,
  day: string,
  time: string,
): ScheduleOverride => ({
  id: `${kind}-${refId}-${day}`,
  kind,
  refId,
  day,
  time,
})

const at = (plan: Planned[], id: string) => {
  const p = plan.find((x) => x.id === id)
  return p && "at" in p ? p.at.getTime() : undefined
}
const weekly = (plan: Planned[], id: string) =>
  plan.some((x) => x.id === id && "weekly" in x)

test("a habit moved today reminds at the moved time, and its own time from next week", () => {
  const plan = planReminders([], [habit()], NOW, {
    overrides: [moved("habit", "h1", TODAY, "14:30")],
  })
  expect(at(plan, `habit-h1-${THU}-09:00-moved-0`)).toBe(
    local(22, 14, 30).getTime(),
  )
  expect(at(plan, `habit-h1-${THU}-09:00`)).toBe(local(29, 9).getTime())
  // Every other weekday keeps its repeating reminder at 09:00.
  for (const wd of [0, 1, 2, 3, 5, 6])
    expect(weekly(plan, `habit-h1-${wd}-09:00`)).toBe(true)
  expect(weekly(plan, `habit-h1-${THU}-09:00`)).toBe(false)
})

test("a habit moved for Saturday changes Saturday only", () => {
  const plan = planReminders([], [habit()], NOW, {
    overrides: [moved("habit", "h1", "2026-10-24", "07:15")],
  })
  expect(at(plan, "habit-h1-6-09:00-moved-2")).toBe(local(24, 7, 15).getTime())
  expect(at(plan, "habit-h1-6-09:00")).toBe(local(31, 9).getTime())
  expect(weekly(plan, `habit-h1-${THU}-09:00`)).toBe(true)
})

test("moved into the small hours: the reminder is after midnight", () => {
  const plan = planReminders([], [habit()], NOW, {
    overrides: [moved("habit", "h1", TODAY, "01:00")],
  })
  expect(at(plan, `habit-h1-${THU}-09:00-moved-0`)).toBe(local(23, 1).getTime())
})

test("done today: no reminder at the moved time", () => {
  const plan = planReminders([], [habit()], NOW, {
    overrides: [moved("habit", "h1", TODAY, "14:30")],
    logs: [
      {
        id: "l1",
        habitId: "h1",
        day: TODAY,
        status: "done",
        loggedAt: NOW.toISOString(),
        source: "tap",
      },
    ],
  })
  expect(plan.some((p) => p.id.endsWith("-moved-0"))).toBe(false)
  expect(at(plan, `habit-h1-${THU}-09:00`)).toBe(local(29, 9).getTime())
})

test("keep-reminding repeats count from the moved time", () => {
  const plan = planReminders([], [habit({ nagEveryMin: 60 })], NOW, {
    overrides: [moved("habit", "h1", TODAY, "20:00")],
  })
  const nags = plan.filter((p) => p.id.startsWith("habit-h1-nag-2026-10-22"))
  expect(nags.map((p) => ("at" in p ? p.at.getHours() : -1))).toEqual([
    21, 22, 23,
  ])
})

test("a routine moved today reminds at the moved time", () => {
  const routine = {
    id: "r1",
    name: "Morning",
    icon: "☀️",
    reminder: true,
    status: "active",
    steps: [{ habitId: "h1", minutes: 5 }],
    schedule: [{ days: [THU], time: "06:00" }],
  } as unknown as Routine
  const plan = planReminders([], [], NOW, {
    routines: [routine],
    overrides: [moved("routine", "r1", TODAY, "10:00")],
  })
  expect(at(plan, `routine-r1-${THU}-06:00-moved-0`)).toBe(
    local(22, 10).getTime(),
  )
  expect(at(plan, `routine-r1-${THU}-06:00`)).toBe(local(29, 6).getTime())
})

test("a recurring task's moved occurrence reminds as much later, at the moved time", () => {
  const t = {
    id: "t1",
    title: "Stand-up",
    status: "open",
    dueDate: TODAY,
    dueTime: "10:00",
    remindAt: local(22, 10).toISOString(),
    recurrence: { rule: { kind: "daily" }, mode: "fixed" },
  } as Task
  const plan = planReminders([t], [], NOW, {
    overrides: [moved("task", "t1", TODAY, "15:00")],
  })
  const p = plan.find((x) => x.id === "task-t1")
  expect(p && "at" in p ? p.at.getTime() : 0).toBe(local(22, 15).getTime())
  expect(p?.body).toBe("Due at 15:00")
})
