// Per-day schedule overrides: a habit, routine or recurring task's
// occurrence moved to another time on one day from the Plan tab. The item's
// own schedule ("Every day · 9am") never changes; a one-off task is moved by
// changing its due time instead, since it has no series to protect.

export type OverrideKind = "habit" | "routine" | "task"

export interface ScheduleOverride {
  id: string
  kind: OverrideKind
  /** The habit, routine or task moved. */
  refId: string
  /** The business day it moved on (YYYY-MM-DD, local). */
  day: string
  /** HH:MM, 24-hour; before 04:00 is the small hours of ``day``. */
  time: string
}

export interface ScheduleState {
  overrides: ScheduleOverride[]
}
