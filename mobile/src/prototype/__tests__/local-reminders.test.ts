// Reminders scheduled on the phone: future task reminders and habit
// reminder slots, soonest first, capped for iOS, and a re-sync replaces
// only this app's own notifications.

import type { Occurrence } from "@domain/finance/calc"
import type { PlannedItem } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import type { Habit, HabitLog, Routine } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import {
  MAX_PENDING,
  planReminders,
  scheduleEatBackReminder,
  syncReminders,
} from "../local-reminders"

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
  finStore.set((s) => ({ ...s, planned: [] }))
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

describe("reminders skip what's already done today", () => {
  // Thursday (weekday 4) 08:00, local time; the app's day is 2026-10-22.
  const now = new Date(2026, 9, 22, 8, 0)
  const thursdayEvening = habit({
    schedule: [{ days: [2, 4], time: "18:00" }],
  })
  const log = (extra: Partial<HabitLog> = {}): HabitLog => ({
    id: "l1",
    habitId: "h1",
    day: "2026-10-22",
    status: "done",
    loggedAt: now.toISOString(),
    source: "tap",
    ...extra,
  })

  test("nothing logged: weekly reminders as usual", () => {
    const plan = planReminders([], [thursdayEvening], now, { logs: [] })
    expect(plan.map((p) => p.id)).toEqual([
      "habit-h1-2-18:00",
      "habit-h1-4-18:00",
    ])
    expect(plan.every((p) => "weekly" in p)).toBe(true)
  })

  test("done or skipped today: today's reminder moves to next week, the others stay", () => {
    for (const status of ["done", "skipped"] as const) {
      const plan = planReminders([], [thursdayEvening], now, {
        logs: [log({ status })],
      })
      expect(plan).toEqual([
        expect.objectContaining({
          id: "habit-h1-2-18:00",
          weekly: { weekday: 3, hour: 18, minute: 0 },
        }),
        expect.objectContaining({
          id: "habit-h1-4-18:00",
          at: new Date(2026, 9, 29, 18, 0),
        }),
      ])
    }
  })

  test("a count habit only part-way there still gets today's reminder", () => {
    const plan = planReminders(
      [],
      [{ ...thursdayEvening, type: "count", target: 8 } as Habit],
      now,
      { logs: [log({ status: "partial", value: 3 })] },
    )
    expect(plan.every((p) => "weekly" in p)).toBe(true)
  })

  test("another day's log changes nothing", () => {
    const plan = planReminders([], [thursdayEvening], now, {
      logs: [log({ day: "2026-10-20" })],
    })
    expect(plan.every((p) => "weekly" in p)).toBe(true)
  })

  test("a sync reads today's logs and weigh-ins from the stores", async () => {
    tasksStore.set((s) => ({ ...s, tasks: [] }))
    habitsStore.set((s) => ({
      ...s,
      habits: [thursdayEvening],
      routines: [],
      logs: [log()],
    }))
    fitStore.set((s) => ({
      ...s,
      settings: { ...s.settings, weighInReminder: "07:00" },
      weighIns: [
        {
          ...(s.weighIns[0] as (typeof s.weighIns)[number]),
          measuredAt: now.toISOString(),
        },
      ],
    }))
    const triggers: Record<string, string> = {}
    const N = {
      getPermissionsAsync: async () => ({ status: "granted" }),
      getAllScheduledNotificationsAsync: async () => [],
      cancelScheduledNotificationAsync: async () => {},
      scheduleNotificationAsync: async (r: {
        identifier: string
        trigger: { type: string }
      }) => {
        triggers[r.identifier] = r.trigger.type
        return r.identifier
      },
      SchedulableTriggerInputTypes: {
        DATE: "date",
        WEEKLY: "weekly",
        DAILY: "daily",
      },
    } as unknown as typeof import("expo-notifications")
    await syncReminders(N, now)
    expect(triggers["habit-h1-4-18:00"]).toBe("date")
    expect(triggers["habit-h1-2-18:00"]).toBe("weekly")
    expect(triggers["weigh-in"]).toBeUndefined()
    expect(triggers["weigh-in-1"]).toBe("date")
  })

  test("weighed in already today: the next six mornings, not today's", () => {
    const plan = planReminders([], [], now, {
      weighIn: "07:00",
      weighedToday: true,
    })
    expect(plan.map((p) => ("at" in p ? p.at : null))).toEqual(
      [23, 24, 25, 26, 27, 28].map((d) => new Date(2026, 9, d, 7, 0)),
    )
    expect(plan.map((p) => p.id)).toEqual(
      [1, 2, 3, 4, 5, 6].map((n) => `weigh-in-${n}`),
    )
  })
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

describe("the evening eat-back reminder", () => {
  const fakeN = () => {
    const scheduled: {
      identifier: string
      date: Date
      href: string
      body: string
    }[] = []
    const cancelled: string[] = []
    const N = {
      getPermissionsAsync: async () => ({ status: "granted" }),
      cancelScheduledNotificationAsync: async (id: string) => {
        cancelled.push(id)
      },
      scheduleNotificationAsync: async (r: {
        identifier: string
        content: { body: string; data: { href: string } }
        trigger: { date: Date }
      }) => {
        scheduled.push({
          identifier: r.identifier,
          date: r.trigger.date,
          href: r.content.data.href,
          body: r.content.body,
        })
        return r.identifier
      },
      SchedulableTriggerInputTypes: { DATE: "date" },
    } as unknown as typeof import("expo-notifications")
    return { N, scheduled, cancelled }
  }
  const at = (h: number) => new Date(2026, 9, 28, h, 0)

  test("burned well past what was added: one reminder at 20:00 today", async () => {
    const { N, scheduled, cancelled } = fakeN()
    await scheduleEatBackReminder(300, 0, N, at(15))
    expect(cancelled).toEqual(["eat-back"])
    // No number: it would be stale by 20:00, after more burning.
    expect(scheduled).toEqual([
      {
        identifier: "eat-back",
        date: at(20),
        href: "/nutrition",
        body: "Apple Health counted calories you haven't added to today's budget. Tap to add them, or ignore.",
      },
    ])
  })

  test("within 100 kcal of what was added: none, and any pending one goes", async () => {
    const { N, scheduled, cancelled } = fakeN()
    await scheduleEatBackReminder(300, 250, N, at(15))
    expect(cancelled).toEqual(["eat-back"])
    expect(scheduled).toEqual([])
  })

  test("after 20:00: none", async () => {
    const { N, scheduled } = fakeN()
    await scheduleEatBackReminder(300, 0, N, at(21))
    expect(scheduled).toEqual([])
  })
})

describe("bill reminders", () => {
  const bill = (
    extra: Partial<Occurrence> = {},
    item: Partial<PlannedItem> = {},
  ) =>
    ({
      item: {
        id: "p1",
        name: "BPI Credit Card",
        type: "transfer",
        amount: 5000,
        ...item,
      },
      day: "2026-10-25",
      orig: "2026-10-25",
      status: "upcoming",
      ...extra,
    }) as Occurrence
  const plan = (bills: Occurrence[], billAmount?: (n: number) => string) =>
    planReminders([], [], NOW, { bills, billAmount }) as {
      id: string
      body: string
      at: Date
    }[]

  test("one a day at 09:00 from today to the due day", () => {
    const p = plan([bill()], (n) => `₱${n}`)
    expect(p.map((r) => [r.at.getDate(), r.at.getHours(), r.body])).toEqual([
      [22, 9, "Due in 3 days · ₱5000"],
      [23, 9, "Due in 2 days · ₱5000"],
      [24, 9, "Due tomorrow · ₱5000"],
      [25, 9, "Due today · ₱5000"],
    ])
  })

  test("a bill a week out starts six days before", () => {
    const p = plan([bill({ day: "2026-11-01", orig: "2026-11-01" })])
    expect(p).toHaveLength(7)
    expect(p[0]?.at.getDate()).toBe(26)
    expect(p[0]?.body).toBe("Due in 6 days")
  })

  test("paid, skipped and income are not reminded", () => {
    expect(
      plan([
        bill({ status: "paid" }),
        bill({ status: "skipped" }),
        bill({}, { type: "income" }),
      ]),
    ).toEqual([])
  })

  test("a sync reads bills from the finance store", async () => {
    resetAll()
    // Only the bill: seed tasks and habits would take the soonest slots.
    tasksStore.set((s) => ({ ...s, tasks: [] }))
    habitsStore.set((s) => ({ ...s, habits: [], routines: [] }))
    fitStore.set((s) => ({
      ...s,
      settings: { ...s.settings, weighInReminder: "" },
    }))
    finStore.set((s) => ({
      ...s,
      records: [],
      planned: [
        {
          id: "nf",
          name: "Netflix",
          type: "expense",
          amount: 549,
          estimated: false,
          accountId: "a",
          schedule: { kind: "monthly", day: 24 },
          start: "2026-01-24",
          end: { kind: "never" },
          autoLog: false,
          isWhatIf: false,
          inProjection: true,
          archived: false,
          skipped: [],
          snoozed: {},
        } as PlannedItem,
      ],
    }))
    const scheduled: string[] = []
    const N = {
      getPermissionsAsync: async () => ({ status: "granted" }),
      getAllScheduledNotificationsAsync: async () => [],
      cancelScheduledNotificationAsync: async () => {},
      scheduleNotificationAsync: async (r: { identifier: string }) => {
        scheduled.push(r.identifier)
        return r.identifier
      },
      SchedulableTriggerInputTypes: { DATE: "date", WEEKLY: "weekly" },
    } as unknown as typeof import("expo-notifications")
    await syncReminders(N, NOW)
    // Due the 24th, today the 22nd: the 22nd, 23rd and 24th; and next
    // month's week is already set too.
    const ids = scheduled.filter((s) => s.startsWith("bill-nf-"))
    expect(ids.filter((s) => s.includes("2026-10-24"))).toHaveLength(3)
    expect(ids.filter((s) => s.includes("2026-11-24"))).toHaveLength(7)
  })
})
