// Reminders scheduled on the phone: future task reminders and habit
// reminder slots, soonest first, capped for iOS, and a re-sync replaces
// only this app's own notifications.

import { fitStore } from "@domain/fitness/store"
import type { Habit, Routine } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { MAX_PENDING, planReminders, syncReminders } from "../local-reminders"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

const NOW = new Date("2026-10-22T08:00:00+08:00")
const task = (id: string, remindAt: string | null, extra: Partial<Task> = {}) =>
  ({
    id,
    title: `Task ${id}`,
    status: "open",
    dueDate: "2026-10-22",
    dueTime: "17:00",
    remindAt,
    ...extra,
  }) as Task
const habit = (extra: Partial<Habit> = {}) =>
  ({
    id: "h1",
    name: "Stretch",
    icon: "🧘",
    reminder: true,
    status: "active",
    schedule: [{ days: [1, 3], time: "06:30" }],
    ...extra,
  }) as Habit

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("future task reminders and habit slots are planned; the rest are not", () => {
  const plan = planReminders(
    [
      task("later", "2026-10-22T16:30:00+08:00"),
      task("soon", "2026-10-22T09:00:00+08:00"),
      task("past", "2026-10-22T07:00:00+08:00"),
      task("done", "2026-10-22T10:00:00+08:00", { status: "done" }),
      task("none", null),
    ],
    [
      habit(),
      habit({ id: "h2", reminder: false }),
      habit({ id: "h3", status: "paused" }),
    ],
    NOW,
  )
  expect(plan.map((p) => p.id)).toEqual([
    "habit-h1-1-06:30",
    "habit-h1-3-06:30",
    "task-soon",
    "task-later",
  ])
  // Monday (1) becomes iOS weekday 2.
  expect(plan[0]).toMatchObject({
    weekly: { weekday: 2, hour: 6, minute: 30 },
    href: "/habits/h1",
  })
  expect(plan[2]).toMatchObject({
    body: "Due at 17:00",
    href: "/tasks/task/soon",
  })
})

test("never more than iOS allows, soonest tasks kept", () => {
  const many = Array.from({ length: 100 }, (_, i) =>
    task(
      String(i),
      new Date(NOW.getTime() + (i + 1) * 3_600_000).toISOString(),
    ),
  )
  const plan = planReminders(many, [habit()], NOW)
  expect(plan).toHaveLength(MAX_PENDING)
  expect(plan.at(-1)?.id).toBe(`task-${MAX_PENDING - 3}`)
})

test("a sync replaces only this app's reminders, and needs permission", async () => {
  tasksStore.set((s) => ({
    ...s,
    tasks: [task("a", "2026-10-22T09:00:00+08:00")],
  }))
  habitsStore.set((s) => ({ ...s, habits: [], routines: [] }))
  fitStore.set((s) => ({
    ...s,
    settings: { ...s.settings, weighInReminder: "" },
  }))
  const scheduled: string[] = []
  const cancelled: string[] = []
  let status = "denied"
  const N = {
    getPermissionsAsync: async () => ({ status }),
    getAllScheduledNotificationsAsync: async () => [
      { identifier: "task-old" },
      { identifier: "someone-else" },
    ],
    cancelScheduledNotificationAsync: async (id: string) => {
      cancelled.push(id)
    },
    scheduleNotificationAsync: async (r: { identifier: string }) => {
      scheduled.push(r.identifier)
      return r.identifier
    },
    SchedulableTriggerInputTypes: { DATE: "date", WEEKLY: "weekly" },
  } as unknown as typeof import("expo-notifications")
  expect(await syncReminders(N, NOW)).toBe(0)
  expect(scheduled).toEqual([])
  status = "granted"
  expect(await syncReminders(N, NOW)).toBe(1)
  expect(cancelled).toEqual(["task-old"])
  expect(scheduled).toEqual(["task-a"])
})

describe("routines and the weigh-in", () => {
  const routine = (extra: Partial<Routine> = {}) =>
    ({
      id: "r1",
      name: "Morning routine",
      icon: "🌅",
      reminder: true,
      status: "active",
      steps: [{ habitId: "h1", minutes: 5 }],
      schedule: [{ days: [0, 6], time: "09:00" }],
      ...extra,
    }) as Routine

  it("a routine with reminders on is reminded on its days", () => {
    const plan = planReminders([], [], NOW, { routines: [routine()] })
    expect(plan.map((p) => [p.id, "weekly" in p ? p.weekly : null])).toEqual([
      ["routine-r1-0-09:00", { weekday: 1, hour: 9, minute: 0 }],
      ["routine-r1-6-09:00", { weekday: 7, hour: 9, minute: 0 }],
    ])
    expect(plan[0].href).toBe("/habits/routines/r1")
  })

  it("leaves out routines with reminders off, archived or empty", () => {
    const plan = planReminders([], [], NOW, {
      routines: [
        routine({ id: "off", reminder: false }),
        routine({ id: "old", status: "archived" }),
        routine({ id: "empty", steps: [] }),
      ],
    })
    expect(plan).toEqual([])
  })

  it("the weigh-in time is a daily reminder; empty is off", () => {
    const [p] = planReminders([], [], NOW, { weighIn: "06:30" })
    expect(p).toMatchObject({ id: "weigh-in", daily: { hour: 6, minute: 30 } })
    expect(planReminders([], [], NOW, { weighIn: "" })).toEqual([])
  })
})
