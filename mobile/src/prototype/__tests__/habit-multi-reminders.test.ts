// Several reminder times for one habit (skin care twice a day): each time
// is its own push, today's later ones stop once the day's target is met,
// the copy names the habit and how far today is, and with many habits the
// iOS cap still keeps everything due in the next day, bills and tasks too.

import type { Occurrence } from "@domain/finance/calc"
import { EVERY_DAY, type Habit, type HabitLog } from "@domain/habits/data"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { Task } from "@domain/tasks/data"
import { MAX_PENDING, type Planned, planReminders } from "../local-reminders"

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
})

// Thursday (weekday 4), noon local; the app's day is 2026-10-22.
const NOW = new Date(2026, 9, 22, 12, 0)
const skin = (extra: Partial<Habit> = {}) =>
  ({
    id: "h1",
    name: "Skin care",
    icon: "🧴",
    type: "count",
    target: 2,
    reminder: true,
    status: "active",
    pauses: [],
    schedule: [
      { days: EVERY_DAY, time: "08:00" },
      { days: EVERY_DAY, time: "20:00" },
    ],
    ...extra,
  }) as Habit
const log = (extra: Partial<HabitLog> = {}): HabitLog => ({
  id: "l1",
  habitId: "h1",
  day: "2026-10-22",
  status: "partial",
  value: 1,
  loggedAt: NOW.toISOString(),
  source: "tap",
  ...extra,
})
const dated = (p: Planned[]) =>
  p.filter((x): x is Extract<Planned, { at: Date }> => "at" in x)
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

test("two times a day: a push at each, every day", () => {
  const plan = planReminders([], [skin()], NOW, { logs: [] })
  for (const d of EVERY_DAY)
    for (const time of ["08:00", "20:00"])
      expect(plan.map((p) => p.id)).toContain(`habit-h1-${d}-${time}`)
  // Saturday at 20:00 is iOS weekday 7.
  expect(plan.find((p) => p.id === "habit-h1-6-20:00")).toMatchObject({
    weekly: { weekday: 7, hour: 20, minute: 0 },
  })
})

test("part-way: tonight's push still comes and says how far today is", () => {
  const plan = planReminders([], [skin()], NOW, { logs: [log()] })
  const tonight = dated(plan).filter((p) => sameDay(p.at, NOW))
  expect(tonight).toHaveLength(1)
  expect(tonight[0]).toMatchObject({
    at: new Date(2026, 9, 22, 20, 0),
    title: "🧴 Skin care",
  })
  expect(tonight[0]?.body).toContain("1 of 2 done")
})

test("done for the day: no more pushes today, tomorrow's stay", () => {
  for (const status of ["done", "skipped"] as const) {
    const plan = planReminders([], [skin()], NOW, {
      logs: [log({ status, value: 2 })],
    })
    expect(dated(plan).some((p) => sameDay(p.at, NOW))).toBe(false)
    // Today's slots come back next Thursday; Friday's are untouched.
    expect(plan.find((p) => p.id === "habit-h1-4-20:00")).toMatchObject({
      at: new Date(2026, 9, 29, 20, 0),
    })
    expect(plan.find((p) => p.id === "habit-h1-5-20:00")).toMatchObject({
      weekly: { weekday: 6, hour: 20, minute: 0 },
    })
  }
})

test("the copy names the habit and its target, with no loss words", () => {
  const habits = [
    skin(),
    skin({ id: "h2", name: "Read", icon: "📖", type: "duration", target: 20 }),
    skin({ id: "h3", name: "Floss", icon: "🦷", type: "check" }),
  ]
  const plan = planReminders([], habits, NOW, { logs: [log()] })
  const body = (id: string) => plan.find((p) => p.id === id)?.body ?? ""
  expect(body("habit-h1-5-08:00")).toBe("Skin care: 2 today. Tap to log one.")
  expect(body("habit-h2-5-08:00")).toBe("Read: 20 min today. Tap to start.")
  expect(body("habit-h3-5-08:00")).toBe("Time for Floss. Tap to check it off.")
  for (const p of plan) {
    expect(`${p.title} ${p.body}`).not.toMatch(
      /at risk|lose|about to end|don't break|missed again|🔥|💀|😢/i,
    )
  }
})

test("fifteen habits three times a day: everything in the next day fits, bills and tasks first among them", () => {
  const habits = Array.from({ length: 15 }, (_, i) =>
    skin({
      id: `h${i}`,
      name: `Habit ${i}`,
      schedule: [
        { days: EVERY_DAY, time: "08:00" },
        { days: EVERY_DAY, time: "13:30" },
        { days: EVERY_DAY, time: "20:00" },
      ],
    }),
  )
  const task = {
    id: "t1",
    title: "Call the dentist",
    status: "open",
    dueDate: "2026-10-22",
    dueTime: "15:00",
    remindAt: new Date(2026, 9, 22, 15, 0).toISOString(),
  } as Task
  const bill = {
    item: { id: "p1", name: "Rent", type: "expense", amount: 9000 },
    day: "2026-10-22",
    orig: "2026-10-22",
    status: "upcoming",
    amount: 9000,
  } as Occurrence
  const plan = planReminders([task], habits, NOW, {
    logs: [],
    bills: [bill],
    billReminder: "13:00",
  })
  expect(plan.length).toBeLessThanOrEqual(MAX_PENDING)
  const ids = plan.map((p) => p.id)
  expect(ids).toContain("task-t1")
  expect(ids).toContain("bill-p1-2026-10-22-0")
  // Today 13:30 and 20:00, tomorrow 08:00: all 45 within a day.
  for (let i = 0; i < 15; i++) {
    expect(ids).toContain(`habit-h${i}-4-13:30`)
    expect(ids).toContain(`habit-h${i}-4-20:00`)
    expect(ids).toContain(`habit-h${i}-5-08:00`)
  }
  // The room left goes to the soonest after that: Friday 13:30, not Sunday.
  expect(ids).toContain("habit-h0-5-13:30")
  expect(ids.some((id) => id.endsWith("-0-08:00"))).toBe(false)
})
