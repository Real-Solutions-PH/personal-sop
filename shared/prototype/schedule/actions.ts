import type { CalendarItem } from "../contract"
import { updateTask } from "../tasks/actions"
import { tasksStore } from "../tasks/store"
import type { ScheduleOverride } from "./data"
import {
  dayMinutes,
  findOverride,
  type ItemRef,
  isClock,
  itemRef,
  overrideId,
} from "./logic"
import { scheduleStore } from "./store"

/** What a move did: the item now sits at ``time`` for that day only
 * (``moved``), it is back at its own time (``reset``), a one-off task's due
 * time changed (``retimed``), or nothing moved (``fixed``: a workout, a focus
 * session or a bill, or an unknown task). */
export type MoveOutcome = "moved" | "reset" | "retimed" | "fixed"

/** Replace (or, with null, remove) the item's override for ``day``. A row
 * pulled from another device may carry another id: matched by item too. */
function put(ref: ItemRef, day: string, time: string | null) {
  const id = overrideId(ref.kind, ref.refId, day)
  scheduleStore.set((s) => {
    const kept = s.overrides.filter(
      (x) =>
        x.id !== id &&
        !(x.kind === ref.kind && x.refId === ref.refId && x.day === day),
    )
    const mine: ScheduleOverride | null =
      time === null ? null : { id, kind: ref.kind, refId: ref.refId, day, time }
    return { overrides: mine ? [...kept, mine] : kept }
  })
}

/**
 * Move one calendar item to ``time`` on its day. A habit, a routine or an
 * occurrence of a recurring task gets a per-day override, so its own
 * schedule and the next occurrence keep their time; dropping it back on
 * that time clears the override. A one-off task's due time moves (and its
 * reminder with it), since that time is its only one.
 */
export function moveItem(item: CalendarItem, time: string): MoveOutcome {
  const ref = itemRef(item)
  if (!ref || !isClock(time)) return "fixed"
  if (ref.kind === "task") {
    const t = tasksStore.get().tasks.find((x) => x.id === ref.refId)
    if (!t || t.status === "deleted") return "fixed"
    if (!t.recurrence) {
      // A move kept from while it repeated would pin it: its time is now
      // the due time alone.
      put(ref, item.day, null)
      const shift =
        t.remindAt && t.dueTime
          ? (dayMinutes(time) - dayMinutes(t.dueTime)) * 60_000
          : 0
      updateTask(t.id, {
        dueTime: time,
        ...(shift && t.remindAt
          ? {
              remindAt: new Date(
                new Date(t.remindAt).getTime() + shift,
              ).toISOString(),
            }
          : {}),
      })
      return "retimed"
    }
    if (time === t.dueTime) {
      put(ref, item.day, null)
      return "reset"
    }
  } else if (
    item.movedFrom !== undefined &&
    item.movedFrom !== null &&
    time === item.movedFrom
  ) {
    put(ref, item.day, null)
    return "reset"
  } else if (item.movedFrom === undefined && time === item.time) {
    return "fixed"
  }
  put(ref, item.day, time)
  return "moved"
}

/** Back to its own time for that day. */
export function resetItem(item: Pick<CalendarItem, "id" | "day">): boolean {
  const ref = itemRef(item)
  if (!ref) return false
  if (
    !findOverride(scheduleStore.get().overrides, ref.kind, ref.refId, item.day)
  )
    return false
  put(ref, item.day, null)
  return true
}
