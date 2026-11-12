import type { CalendarItem } from "@domain/contract"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { moveItem, resetItem } from "@domain/schedule/actions"
import {
  clockOf,
  DAY_FIRST_MIN,
  DAY_LAST_MIN,
  dayMinutes,
  itemRef,
  overrideId,
  snapMinutes,
  withOverrides,
} from "@domain/schedule/logic"
import { scheduleStore } from "@domain/schedule/store"
import { completeTask, createTask } from "@domain/tasks/actions"
import { tasksStore } from "@domain/tasks/store"

const H = "8f5e2c1a-0b7d-4c3e-9a21-6d4f0e8b2a10"
const DAY = "2026-11-12"

const habitItem = (time = "09:00", day = DAY): CalendarItem => ({
  id: `habit-${H}-${day}`,
  day,
  time,
  title: "📖 Read",
  module: "habits",
  href: `/habits/${H}`,
})

beforeEach(() => {
  scheduleStore.reset()
  tasksStore.reset()
  habitsStore.reset()
})

describe("itemRef", () => {
  it("reads a habit, a routine and a task from their calendar ids", () => {
    expect(itemRef(habitItem())).toEqual({ kind: "habit", refId: H })
    expect(itemRef({ id: `routine-r1-${DAY}`, day: DAY })).toEqual({
      kind: "routine",
      refId: "r1",
    })
    expect(itemRef({ id: "task:t-9", day: DAY })).toEqual({
      kind: "task",
      refId: "t-9",
    })
  })
  it("leaves workouts, focus sessions and bills where they are", () => {
    for (const id of ["fit-w1", `focus-s1-${DAY}`, `fin-b1-${DAY}`])
      expect(itemRef({ id, day: DAY })).toBeNull()
  })
  it("refuses a habit id whose day is not the item's day", () => {
    expect(itemRef({ id: `habit-${H}-2026-11-13`, day: DAY })).toBeNull()
  })
})

describe("the 15-minute grid on the business day", () => {
  it("counts the small hours after midnight", () => {
    expect(dayMinutes("01:30")).toBe(25 * 60 + 30)
    expect(dayMinutes("04:00")).toBe(DAY_FIRST_MIN)
    expect(clockOf(25 * 60 + 30)).toBe("01:30")
    expect(clockOf(dayMinutes("23:45"))).toBe("23:45")
  })
  it("snaps to the nearest quarter hour inside the day", () => {
    expect(clockOf(snapMinutes(9 * 60 + 7))).toBe("09:00")
    expect(clockOf(snapMinutes(9 * 60 + 8))).toBe("09:15")
    expect(snapMinutes(60)).toBe(DAY_FIRST_MIN)
    expect(snapMinutes(40 * 60)).toBe(DAY_LAST_MIN)
    expect(clockOf(DAY_LAST_MIN)).toBe("03:45")
  })
})

describe("withOverrides", () => {
  const moved = {
    id: "o1",
    kind: "habit" as const,
    refId: H,
    day: DAY,
    time: "14:30",
  }
  it("moves the item on that day only and remembers its own time", () => {
    const [today, tomorrow] = withOverrides(
      [habitItem(), habitItem("09:00", "2026-11-13")],
      [moved],
    )
    expect(today).toMatchObject({ time: "14:30", movedFrom: "09:00" })
    expect(tomorrow.time).toBe("09:00")
    expect(tomorrow.movedFrom).toBeUndefined()
  })
  it("knows the own time of a server item that already carries the move", () => {
    const defaults = new Map([[habitItem().id, "09:00"]])
    const [i] = withOverrides([habitItem("14:30")], [moved], defaults)
    expect(i).toMatchObject({ time: "14:30", movedFrom: "09:00" })
  })
  it("puts a reset item back before the server's copy catches up", () => {
    const defaults = new Map([[habitItem().id, "09:00"]])
    const [i] = withOverrides([habitItem("14:30")], [], defaults)
    expect(i.time).toBe("09:00")
    expect(i.movedFrom).toBeUndefined()
  })
  it("marks an untimed item moved from no time", () => {
    const { time: _t, ...untimed } = habitItem()
    const [i] = withOverrides([untimed], [moved])
    expect(i).toMatchObject({ time: "14:30", movedFrom: null })
  })
})

describe("moveItem", () => {
  it("moves a habit for that day only, leaving its schedule alone", () => {
    const before = JSON.stringify(habitsStore.get())
    expect(moveItem(habitItem(), "14:30")).toBe("moved")
    expect(scheduleStore.get().overrides).toEqual([
      {
        id: overrideId("habit", H, DAY),
        kind: "habit",
        refId: H,
        day: DAY,
        time: "14:30",
      },
    ])
    expect(JSON.stringify(habitsStore.get())).toBe(before)
  })
  it("a second move replaces the first; dropping it home resets it", () => {
    moveItem(habitItem(), "14:30")
    const [shown] = withOverrides([habitItem()], scheduleStore.get().overrides)
    expect(moveItem(shown, "16:00")).toBe("moved")
    expect(scheduleStore.get().overrides.map((o) => o.time)).toEqual(["16:00"])
    const [again] = withOverrides([habitItem()], scheduleStore.get().overrides)
    expect(moveItem(again, "09:00")).toBe("reset")
    expect(scheduleStore.get().overrides).toEqual([])
  })
  it("drops a habit back on its own time without writing anything", () => {
    expect(moveItem(habitItem(), "09:00")).toBe("fixed")
    expect(scheduleStore.get().overrides).toEqual([])
  })
  it("resetItem puts it back", () => {
    moveItem(habitItem(), "14:30")
    expect(resetItem(habitItem())).toBe(true)
    expect(scheduleStore.get().overrides).toEqual([])
    expect(resetItem(habitItem())).toBe(false)
  })
  it("retimes a one-off task, its reminder moving with it", () => {
    const day = dayKey()
    const t = createTask({
      title: "Call the bank",
      dueDate: day,
      dueTime: "10:00",
      remind: true,
    })
    const remind = new Date(t.remindAt as string).getTime()
    const item = { ...habitItem(), id: `task:${t.id}`, day, module: "tasks" }
    expect(moveItem(item as CalendarItem, "11:30")).toBe("retimed")
    const after = tasksStore.get().tasks.find((x) => x.id === t.id)
    expect(after?.dueTime).toBe("11:30")
    expect(new Date(after?.remindAt as string).getTime() - remind).toBe(
      90 * 60_000,
    )
    expect(scheduleStore.get().overrides).toEqual([])
  })
  it("moves one occurrence of a recurring task; the next keeps the series time", () => {
    const day = dayKey()
    const t = createTask({
      title: "Stand-up",
      dueDate: day,
      dueTime: "10:00",
      recurrence: { rule: { kind: "daily" }, mode: "fixed" },
    })
    const item = {
      ...habitItem("10:00", day),
      id: `task:${t.id}`,
      module: "tasks",
    } as CalendarItem
    expect(moveItem(item, "15:00")).toBe("moved")
    expect(tasksStore.get().tasks.find((x) => x.id === t.id)?.dueTime).toBe(
      "10:00",
    )
    const next = completeTask(t.id)
    expect(next?.dueTime).toBe("10:00")
    const [shown] = withOverrides([item], scheduleStore.get().overrides)
    expect(shown).toMatchObject({ time: "15:00", movedFrom: "10:00" })
    expect(moveItem(shown, "10:00")).toBe("reset")
  })
  it("never moves a workout, a focus session or a bill", () => {
    const fit = { ...habitItem(), id: "fit-w1", module: "fitness" as const }
    expect(moveItem(fit, "12:00")).toBe("fixed")
    expect(moveItem(habitItem(), "25:00")).toBe("fixed")
    expect(scheduleStore.get().overrides).toEqual([])
  })
})

describe("a task that stopped repeating", () => {
  it("drops the move kept from its repeating days when its time changes", () => {
    const day = dayKey()
    const t = createTask({
      title: "Stand-up",
      dueDate: day,
      dueTime: "10:00",
      recurrence: { rule: { kind: "daily" }, mode: "fixed" },
    })
    const item = {
      ...habitItem("10:00", day),
      id: `task:${t.id}`,
      module: "tasks",
    } as CalendarItem
    moveItem(item, "15:00")
    tasksStore.set((s) => ({
      ...s,
      tasks: s.tasks.map((x) =>
        x.id === t.id ? { ...x, recurrence: null } : x,
      ),
    }))
    expect(moveItem(item, "12:00")).toBe("retimed")
    expect(scheduleStore.get().overrides).toEqual([])
    const [shown] = withOverrides(
      [{ ...item, time: "12:00" }],
      scheduleStore.get().overrides,
    )
    expect(shown.time).toBe("12:00")
  })
})
