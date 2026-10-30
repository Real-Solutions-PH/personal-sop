// What the app hands the native home-screen widgets, the iOS Live Activity
// and the Android ongoing notification (ADR-0020). Native code decodes these
// exact shapes (targets/widget/_shared/UnfurlShared.swift and
// modules/unfurl-surfaces/android), so a field renamed here must be renamed
// there; bump the version when a change is not additive.

export const SNAPSHOT_VERSION = 1

export interface WidgetHabit {
  id: string
  name: string
  icon: string
  streak: number
  done: boolean
  /** "07:30" when the habit has a time today. */
  time?: string
  /** A check habit can be ticked from the widget; counts and timers open
   * the app. */
  checkable: boolean
}
export interface WidgetTask {
  id: string
  title: string
  /** "Overdue", "Today 14:00", "Tomorrow". */
  when: string
  overdue: boolean
}
export interface WidgetMacro {
  eaten: number
  target: number
}
export interface WidgetSnapshot {
  v: number
  /** When the app wrote it (ISO). */
  at: string
  /** The business day it describes (YYYY-MM-DD); a widget showing a day
   * that has ended renders dimmed until the app writes the next. */
  day: string
  /** When that day ends (ISO; the app's day turns at 4:00). */
  dayEnds: string
  today: {
    done: number
    due: number
    /** 0..1 share of today's due items done. */
    pct: number
    /** The day target as a share (0.7). */
    target: number
    headline: string
    lifeScore: number | null
    streak: number
  }
  habits: {
    done: number
    total: number
    items: WidgetHabit[]
  }
  /** Null when no macro target is set. */
  macros: {
    kcal: WidgetMacro
    protein: WidgetMacro
    carbs: WidgetMacro
    fat: WidgetMacro
    meals: number
  } | null
  tasks: {
    open: number
    overdue: number
    items: WidgetTask[]
  }
  /** Null without an overall budget. Amounts are formatted already, in the
   * person's currency; ``hidden`` masks them (the app's privacy toggle). */
  money: {
    safeToday: string
    left: string
    spent: string
    limit: string
    pct: number
    daysLeft: number
    hidden: boolean
  } | null
  /** The routine, workout or timer running now, for the Today widget. */
  live: { kind: LiveKind; title: string; href: string } | null
}

export type LiveKind = "routine" | "workout" | "timer"

/** One upcoming step or set, so a lock-screen tap can move on before the
 * app has run. */
export interface LiveNext {
  /** Routine: the step index; workout: "weId/setId". */
  key: string
  label: string
  detail: string
  /** Planned seconds of a routine step. */
  sec?: number
  /** Workout only: the exercise's previous best ("Best 85 kg × 6"). */
  best?: string
}

export type LiveControl =
  | "done"
  | "skip"
  | "pause"
  | "resume"
  | "finishSet"
  | "skipRest"
  /** Rest 15 seconds more / less, as the in-app buttons. */
  | "addRest"
  | "subRest"
  | "finish"

export interface LiveState {
  kind: LiveKind
  /** Routine run id, workout id or habit id. */
  id: string
  title: string
  icon: string
  /** The current step, exercise or habit. */
  step: string
  detail: string
  /** Workout only: the current exercise's previous best, formatted. */
  best?: string
  /** Routine: current step key ("2"); workout: current "weId/setId". */
  key: string
  /** Steps or working sets done, and how many there are. */
  index: number
  count: number
  paused: boolean
  /** Epoch ms the whole activity's clock reads zero at (pauses excluded);
   * frozen ``elapsedSec`` applies while paused. */
  startedAt: number
  elapsedSec: number
  /** Routine step or timer target countdown. */
  stepEndsAt?: number
  remainingSec?: number
  /** Workout rest countdown. */
  restEndsAt?: number
  restSec: number
  next: LiveNext[]
  controls: LiveControl[]
  href: string
}

/** A lock-screen, Dynamic Island, notification or widget tap, queued by
 * native code until the app applies it. */
export interface SurfaceAction {
  id: string
  type: LiveControl | "checkHabit"
  kind?: LiveKind
  /** Run, workout or habit id. */
  target: string
  /** The step/set the person saw when they tapped (``LiveState.key``);
   * an action whose key no longer matches is stale and dropped. */
  key?: string
  /** Epoch ms of the tap. */
  at: number
}
