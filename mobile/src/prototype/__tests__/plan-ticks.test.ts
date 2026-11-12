// Ticking habits and tasks off from the Plan day, with the same results as
// Today: a habit's log for that day, a task completed, and an Undo that puts
// everything back.

import type { CalendarItem } from "@domain/contract"
import { dashStore } from "@domain/dash/store"
import { createHabit } from "@domain/habits/actions"
import { addDays, lk, logIndex } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { stepItem, tickItem, tickOf, untickItem } from "@domain/schedule/ticks"
import { createTask } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"

const EVERY_DAY = [{ days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" }]

const habitItem = (id: string, day = dayKey()): CalendarItem => ({
  id: `habit-${id}-${day}`,
  day,
  time: "09:00",
  title: "Read",
  module: "habits",
  href: `/habits/${id}`,
})
const taskItem = (id: string, day = dayKey()): CalendarItem => ({
  id: `task:${id}`,
  day,
  title: "Call the bank",
  module: "tasks",
  href: `/tasks/task/${id}`,
})
const logOf = (habitId: string, day = dayKey()) =>
  logIndex(habitsStore.get().logs).get(lk(habitId, day))

beforeEach(() => {
  habitsStore.reset()
  tasksStore.reset()
  habitsStore.set((s) => ({ ...s, habits: [], logs: [], routines: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [] }))
})

describe("tickOf: what a Plan row can tick", () => {
  it("a habit on today or a past day, a task on any day", () => {
    const h = createHabit({ name: "Read", schedule: EVERY_DAY })
    expect(tickOf(habitItem(h.id))).toMatchObject({
      kind: "habit",
      habitId: h.id,
      count: false,
    })
    expect(tickOf(habitItem(h.id, addDays(dayKey(), -2)))).not.toBeNull()
    expect(tickOf(taskItem("t1", addDays(dayKey(), 3)))).toEqual({
      kind: "task",
      taskId: "t1",
    })
  })
  it("never a habit on a day still to come", () => {
    const h = createHabit({ name: "Read", schedule: EVERY_DAY })
    expect(tickOf(habitItem(h.id, addDays(dayKey(), 1)))).toBeNull()
  })
  it("a count habit steps by one", () => {
    const h = createHabit({
      name: "Water",
      type: "count",
      target: 3,
      schedule: EVERY_DAY,
    })
    expect(tickOf(habitItem(h.id))).toMatchObject({ count: true })
  })
  it("never a routine, a workout, a bill or a habit screen time completes", () => {
    const day = dayKey()
    for (const id of [`routine-r1-${day}`, "fit-w1", `fin-p1-${day}`])
      expect(tickOf({ id, day })).toBeNull()
    const auto = createHabit({
      name: "Phone under 2h",
      schedule: EVERY_DAY,
      rule: { kind: "screen_limit", groupId: "g1", maxMin: 120 },
    } as unknown as Parameters<typeof createHabit>[0])
    dashStore.set((s) => ({ ...s, enabled: { ...s.enabled, screen: true } }))
    expect(tickOf(habitItem(auto.id))).toBeNull()
    dashStore.reset()
  })
})

describe("tickItem / untickItem", () => {
  it("checks a habit for the row's day; Undo clears it", () => {
    const h = createHabit({ name: "Read", schedule: EVERY_DAY })
    const day = addDays(dayKey(), -1)
    const r = tickItem(habitItem(h.id, day))
    expect(r).toMatchObject({ completed: true, message: "Habit checked" })
    expect(logOf(h.id, day)?.status).toBe("done")
    expect(logOf(h.id)).toBeUndefined()
    r?.undo()
    expect(logOf(h.id, day)).toBeUndefined()
  })
  it("a count habit goes up by one; only the step that reaches the target completes it", () => {
    const h = createHabit({
      name: "Water",
      type: "count",
      target: 2,
      step: 1,
      schedule: EVERY_DAY,
    })
    const first = stepItem(habitItem(h.id))
    expect(first?.completed).toBe(false)
    expect(logOf(h.id)?.value).toBe(1)
    const second = stepItem(habitItem(h.id))
    expect(second).toMatchObject({ completed: true, message: "Water done" })
    expect(logOf(h.id)?.status).toBe("done")
    second?.undo()
    expect(logOf(h.id)?.value).toBe(1)
    expect(logOf(h.id)?.status).not.toBe("done")
  })
  it("the check marks a count habit done outright, as Today's does", () => {
    const h = createHabit({
      name: "Water",
      type: "count",
      target: 3,
      schedule: EVERY_DAY,
    })
    expect(tickItem(habitItem(h.id))?.completed).toBe(true)
    expect(logOf(h.id)?.status).toBe("done")
  })
  it("only a count habit steps", () => {
    const h = createHabit({ name: "Read", schedule: EVERY_DAY })
    expect(stepItem(habitItem(h.id))).toBeNull()
    expect(stepItem(taskItem("t1"))).toBeNull()
  })
  it("completes a task; Undo reopens it", () => {
    const t = createTask({ title: "Call the bank", dueDate: dayKey() })
    const r = tickItem(taskItem(t.id))
    expect(r).toMatchObject({ completed: true, message: "Task complete" })
    expect(tasksStore.get().tasks.find((x) => x.id === t.id)?.status).toBe(
      "done",
    )
    r?.undo()
    expect(tasksStore.get().tasks.find((x) => x.id === t.id)?.status).toBe(
      "open",
    )
  })
  it("untick reopens a done row at once", () => {
    const h = createHabit({ name: "Read", schedule: EVERY_DAY })
    tickItem(habitItem(h.id))
    untickItem(habitItem(h.id))
    expect(logOf(h.id)).toBeUndefined()
    const t = createTask({ title: "Call the bank", dueDate: dayKey() })
    tickItem(taskItem(t.id))
    untickItem(taskItem(t.id))
    expect(tasksStore.get().tasks.find((x) => x.id === t.id)?.status).toBe(
      "open",
    )
  })
  it("does nothing on a row it cannot tick", () => {
    const day = dayKey()
    expect(
      tickItem({ id: "fit-w1", day, title: "x", module: "fitness", href: "/" }),
    ).toBeNull()
  })
})
