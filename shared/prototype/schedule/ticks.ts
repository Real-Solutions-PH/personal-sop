// Ticking a habit or a task off from a row of the Plan day, with what Today
// does: the habit's log on that row's day (a count habit one step on), the
// task completed, and an Undo that puts back what was there.

import type { CalendarItem } from "../contract"
import { dashStore } from "../dash/store"
import {
  checkHabit,
  clearLog,
  incrementCount,
  restoreLog,
} from "../habits/actions"
import { lk, logIndex, progressOf } from "../habits/logic"
import { habitsStore } from "../habits/store"
import { dayKey } from "../lib/day"
import { completeTask, uncompleteTask } from "../tasks/actions"
import { tasksStore } from "../tasks/store"

export type Tick =
  | { kind: "habit"; habitId: string; day: string; count: boolean }
  | { kind: "task"; taskId: string }

/** The habit id in ``habit-{id}-{day}``, when the id's day is the item's. */
function habitIdOf(item: Pick<CalendarItem, "id" | "day">): string | null {
  const tail = `-${item.day}`
  if (!item.id.startsWith("habit-") || !item.id.endsWith(tail)) return null
  return item.id.slice(6, -tail.length) || null
}

/**
 * What ticking this row does, or null when it has nothing to tick: a
 * routine (it runs in its player), a workout, a focus session or a bill
 * (records with their own flows), a habit on a day still to come, or one
 * screen time completes by itself.
 */
export function tickOf(
  item: Pick<CalendarItem, "id" | "day">,
  today = dayKey(),
): Tick | null {
  if (item.id.startsWith("task:")) {
    const taskId = item.id.slice(5)
    return taskId ? { kind: "task", taskId } : null
  }
  const habitId = habitIdOf(item)
  if (!habitId || item.day > today) return null
  const h = habitsStore.get().habits.find((x) => x.id === habitId)
  if (!h || h.status === "archived") return null
  if (h.rule && dashStore.get().enabled.screen) return null
  return { kind: "habit", habitId, day: item.day, count: h.type === "count" }
}

/** How far the row's habit is toward its target that day (0–1); a task is
 * 0 or 1 from the item. */
export function tickProgress(item: CalendarItem): number {
  const tick = tickOf(item)
  if (tick?.kind !== "habit") return item.done ? 1 : 0
  const s = habitsStore.get()
  const h = s.habits.find((x) => x.id === tick.habitId)
  if (!h) return 0
  return progressOf(h, logIndex(s.logs).get(lk(tick.habitId, tick.day)))
}

export interface Ticked {
  /** It is now done (a count habit's step may fall short of the target). */
  completed: boolean
  /** The tick toast, the same words as Today. */
  message: string
  undo: () => void
}

/** Tick the row off: the task completed, the habit done for that day
 * (whatever its type, as Today's check does). Null when nothing ticked. */
export function tickItem(item: CalendarItem): Ticked | null {
  const tick = tickOf(item)
  if (!tick) return null
  if (tick.kind === "task") {
    const task = tasksStore.get().tasks.find((x) => x.id === tick.taskId)
    if (task?.status !== "open") return null
    completeTask(tick.taskId)
    return {
      completed: true,
      message: "Task complete",
      undo: () => uncompleteTask(tick.taskId),
    }
  }
  const undo = putBack(tick.habitId, tick.day)
  if (!checkHabit(tick.habitId, tick.day)) return null
  return { completed: true, message: "Habit checked", undo }
}

/** A count habit one step on for the row's day (Today's +1). Completed only
 * by the step that reaches the target. Null for anything else. */
export function stepItem(item: CalendarItem): Ticked | null {
  const tick = tickOf(item)
  if (tick?.kind !== "habit" || !tick.count) return null
  const h = habitsStore.get().habits.find((x) => x.id === tick.habitId)
  if (!h) return null
  const undo = putBack(tick.habitId, tick.day)
  if (!incrementCount(tick.habitId, undefined, tick.day)) return null
  const after = logIndex(habitsStore.get().logs).get(lk(tick.habitId, tick.day))
  return {
    completed: progressOf(h, after) >= 1,
    message: `${h.name} done`,
    undo,
  }
}

/** Undo for a habit change on ``day``: the log that was there, or none. */
function putBack(habitId: string, day: string) {
  const before = logIndex(habitsStore.get().logs).get(lk(habitId, day))
  return () => {
    clearLog(habitId, day)
    if (before) restoreLog(before)
  }
}

/** Reopen a done row at once, as Today does. */
export function untickItem(item: CalendarItem): void {
  const tick = tickOf(item)
  if (!tick) return
  if (tick.kind === "task") uncompleteTask(tick.taskId)
  else clearLog(tick.habitId, tick.day)
}
