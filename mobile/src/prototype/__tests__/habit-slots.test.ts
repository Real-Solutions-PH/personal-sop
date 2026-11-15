// A habit with several reminder times shows once per time in the timeline
// views (habits/slots): skin care at 08:00 and 20:00 is a morning row and a
// night row, each done by its own share of the day's count, and ticking or
// reopening one moves the count through the ordinary log.

import type { CalendarItem } from "@domain/contract"
import { createHabit } from "@domain/habits/actions"
import {
  EVERY_DAY,
  type Habit,
  type HabitLog,
  type ScheduleSlot,
} from "@domain/habits/data"
import { lk, logIndex } from "@domain/habits/logic"
import {
  expandHabitSlots,
  habitOccurrences,
  occurrenceDone,
  parseHabitItem,
} from "@domain/habits/slots"
import { habitsStore } from "@domain/habits/store"
import { dayKey, weekday } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { itemRef } from "@domain/schedule/logic"
import {
  tickItem,
  tickOf,
  tickProgress,
  untickItem,
} from "@domain/schedule/ticks"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
})

const DAY = "2026-11-12" // a Thursday
const TWICE: ScheduleSlot[] = [
  { days: EVERY_DAY, time: "08:00" },
  { days: EVERY_DAY, time: "20:00" },
]
const habit = (extra: Partial<Habit> = {}) =>
  ({
    id: "h1",
    name: "Skin care",
    icon: "🧴",
    type: "count",
    target: 2,
    step: 1,
    reminder: true,
    status: "active",
    pauses: [],
    linkWorkout: false,
    createdAt: "2026-01-01",
    sortOrder: 0,
    schedule: TWICE,
    ...extra,
  }) as Habit
const log = (value: number | undefined, status: HabitLog["status"]) =>
  ({
    id: "l1",
    habitId: "h1",
    day: DAY,
    status,
    value,
    loggedAt: `${DAY}T12:00:00.000Z`,
    source: "tap",
  }) as HabitLog
const item = (h: Habit, day = DAY, time?: string): CalendarItem => ({
  id: `habit-${h.id}-${day}`,
  day,
  ...(time ? { time } : {}),
  title: `${h.icon} ${h.name}`,
  module: "habits",
  done: false,
  href: `/habits/${h.id}`,
})
const idxOf = (...logs: HabitLog[]) => logIndex(logs)

describe("habitOccurrences", () => {
  it("one per distinct time that day, in time order, the first slot primary", () => {
    const h = habit({
      schedule: [
        { days: EVERY_DAY, time: "20:00" },
        { days: EVERY_DAY, time: "08:00" },
        { days: EVERY_DAY, time: "20:00" },
      ],
    })
    expect(habitOccurrences(h, DAY)).toEqual([
      { n: 1, of: 2, time: "08:00", primary: false },
      { n: 2, of: 2, time: "20:00", primary: true },
    ])
  })
  it("only the slots that hold the weekday; small hours after the evening", () => {
    const wd = weekday(DAY)
    const h = habit({
      schedule: [
        { days: [wd], time: "01:00" },
        { days: [(wd + 1) % 7], time: "09:00" },
        { days: [wd], time: "22:00" },
      ],
    })
    expect(habitOccurrences(h, DAY).map((o) => o.time)).toEqual([
      "22:00",
      "01:00",
    ])
  })
  it("one time, or none, is a single occurrence", () => {
    expect(
      habitOccurrences(habit({ schedule: [{ days: EVERY_DAY }] }), DAY),
    ).toHaveLength(1)
    expect(
      habitOccurrences(
        habit({ schedule: [{ days: EVERY_DAY, time: "08:00" }] }),
        DAY,
      ),
    ).toHaveLength(1)
  })
})

describe("expandHabitSlots", () => {
  it("a habit with two times becomes a morning row and a night row", () => {
    const h = habit()
    const out = expandHabitSlots([item(h, DAY, "08:00")], [h], idxOf())
    expect(out.map((i) => [i.id, i.time, i.done, i.slot])).toEqual([
      [`habit-h1-${DAY}`, "08:00", false, { n: 1, of: 2 }],
      [`habit-h1-${DAY}@2`, "20:00", false, { n: 2, of: 2 }],
    ])
    // Unique keys per occurrence.
    expect(new Set(out.map((i) => i.id)).size).toBe(2)
  })
  it("each row is done by its own share of the count", () => {
    const h = habit()
    const one = expandHabitSlots(
      [item(h, DAY, "08:00")],
      [h],
      idxOf(log(1, "partial")),
    )
    expect(one.map((i) => i.done)).toEqual([true, false])
    const both = expandHabitSlots(
      [item(h, DAY, "08:00")],
      [h],
      idxOf(log(2, "done")),
    )
    expect(both.map((i) => i.done)).toEqual([true, true])
  })
  it("more times than the target share it out; a target of 4 fills by twos", () => {
    const three = habit({
      schedule: [...TWICE, { days: EVERY_DAY, time: "13:00" }],
    })
    const o = habitOccurrences(three, DAY)
    expect(o.map((x) => occurrenceDone(three, x, log(1, "partial")))).toEqual([
      true,
      false,
      false,
    ])
    expect(o.map((x) => occurrenceDone(three, x, log(2, "done")))).toEqual([
      true,
      true,
      true,
    ])
    const four = habit({ target: 4 })
    const f = habitOccurrences(four, DAY)
    expect(f.map((x) => occurrenceDone(four, x, log(3, "partial")))).toEqual([
      true,
      false,
    ])
  })
  it("a check habit's rows all show the day's one state", () => {
    const h = habit({ type: "check", target: undefined })
    const open = expandHabitSlots([item(h, DAY, "08:00")], [h], idxOf())
    expect(open.map((i) => i.done)).toEqual([false, false])
    const done = expandHabitSlots(
      [item(h, DAY, "08:00")],
      [h],
      idxOf(log(undefined, "done")),
    )
    expect(done.map((i) => i.done)).toEqual([true, true])
  })
  it("one time or none: untouched", () => {
    const one = habit({ schedule: [{ days: EVERY_DAY, time: "08:00" }] })
    const none = habit({ id: "h2", schedule: [{ days: EVERY_DAY }] })
    const items = [item(one, DAY, "08:00"), item(none, DAY)]
    const out = expandHabitSlots(items, [one, none], idxOf())
    expect(out).toEqual(items)
    expect(out[0]).toBe(items[0])
  })
  it("a move made on the Plan tab stays on the first slot's row", () => {
    const h = habit()
    const moved = { ...item(h, DAY, "10:30"), movedFrom: "08:00" }
    const out = expandHabitSlots([moved], [h], idxOf())
    expect(out[0]).toMatchObject({ id: `habit-h1-${DAY}`, time: "10:30" })
    expect(out[0].movedFrom).toBe("08:00")
    expect(out[1].movedFrom).toBeUndefined()
  })
  it("the new rows sit in time order among the others", () => {
    const h = habit()
    const noon: CalendarItem = {
      id: "task:t1",
      day: DAY,
      time: "12:00",
      title: "Lunch call",
      module: "tasks",
      href: "/tasks/task/t1",
    }
    const out = expandHabitSlots([item(h, DAY, "08:00"), noon], [h], idxOf())
    expect(out.map((i) => i.time)).toEqual(["08:00", "12:00", "20:00"])
  })
})

describe("occurrence ids", () => {
  it("parse back to the habit and slot; only the plain one can be moved", () => {
    expect(parseHabitItem({ id: `habit-h1-${DAY}@2`, day: DAY })).toEqual({
      habitId: "h1",
      n: 2,
    })
    expect(parseHabitItem({ id: `habit-h1-${DAY}`, day: DAY })).toEqual({
      habitId: "h1",
      n: null,
    })
    expect(parseHabitItem({ id: `habit-h1-${DAY}@x`, day: DAY })).toBeNull()
    expect(itemRef({ id: `habit-h1-${DAY}`, day: DAY })).toEqual({
      kind: "habit",
      refId: "h1",
    })
    expect(itemRef({ id: `habit-h1-${DAY}@2`, day: DAY })).toBeNull()
  })
})

describe("ticking one of several times", () => {
  const rows = (h: Habit) =>
    expandHabitSlots(
      [item(h, dayKey(), "08:00")],
      habitsStore.get().habits,
      logIndex(habitsStore.get().logs),
    )
  const logOf = (id: string) =>
    logIndex(habitsStore.get().logs).get(lk(id, dayKey()))

  it("the morning row logs 1 of 2, the night row the rest", () => {
    const h = createHabit({
      name: "Skin care",
      type: "count",
      target: 2,
      step: 1,
      schedule: TWICE,
    })
    const [morning, night] = rows(h)
    expect(tickOf(night)).toMatchObject({ kind: "habit", habitId: h.id })
    const r = tickItem(morning)
    expect(r?.message).toBe("Skin care 1 of 2 done")
    expect(logOf(h.id)).toMatchObject({ value: 1, status: "partial" })
    expect(rows(h).map((i) => i.done)).toEqual([true, false])
    expect(tickProgress(morning)).toBe(1)
    expect(tickProgress(night)).toBe(0)

    expect(tickItem(night)?.message).toBe("Habit checked")
    expect(logOf(h.id)).toMatchObject({ value: 2, status: "done" })
    expect(rows(h).map((i) => i.done)).toEqual([true, true])

    // Reopening the night row keeps the morning one done.
    untickItem(night)
    expect(logOf(h.id)).toMatchObject({ value: 1, status: "partial" })
    untickItem(morning)
    expect(logOf(h.id)).toBeUndefined()
  })
  it("Undo puts back what was there", () => {
    const h = createHabit({
      name: "Water",
      type: "count",
      target: 2,
      schedule: TWICE,
    })
    const [morning] = rows(h)
    tickItem(morning)?.undo()
    expect(logOf(h.id)).toBeUndefined()
  })
  it("a check habit's row completes the day, as one row does", () => {
    const h = createHabit({ name: "Floss", schedule: TWICE })
    const [morning] = rows(h)
    expect(tickItem(morning)?.message).toBe("Habit checked")
    expect(logOf(h.id)?.status).toBe("done")
    expect(rows(h).map((i) => i.done)).toEqual([true, true])
  })
})
