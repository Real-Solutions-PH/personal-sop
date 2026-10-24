import * as FA from "@domain/fitness/actions"
import { isDone } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as FO from "@domain/focus/actions"
import * as FL from "@domain/focus/logic"
import { focusStore } from "@domain/focus/store"
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { elapsedSec, liveStore } from "@domain/lib/live"
import { drainActions } from "./native"
import type { SurfaceAction } from "./types"

// Taps on the lock screen, Dynamic Island, Android notification or a widget
// reach the app as queued SurfaceActions (native code holds them until JS
// runs). Each one calls the action the in-app button calls, so it lands in
// the same store, outbox and sync as a tap inside the app.
//
// A tap carries the step or set the person was looking at. When that no
// longer matches (the app already moved on, or the same tap was delivered
// twice) the action is dropped rather than applied to the wrong step.

export type ApplyResult = "applied" | "stale" | "unknown"

function routineAction(a: SurfaceAction): ApplyResult {
  const run = habitsStore
    .get()
    .runs.find((r) => r.id === a.target && r.state === "in_progress")
  if (!run) return "stale"
  if (a.type === "pause" || a.type === "resume") {
    const paused = !!run.pausedAt
    if ((a.type === "pause") === paused) return "stale"
    HA.toggleRunPause(run)
    return "applied"
  }
  if (a.key !== undefined && a.key !== String(run.current)) return "stale"
  if (a.type === "done") HA.stepDone(run)
  else if (a.type === "skip") HA.stepSkip(run)
  else if (a.type === "finish") HA.exitRoutine()
  else return "unknown"
  return "applied"
}

/** A lock-screen tap on a focus session (drawn as a timer). */
function focusAction(a: SurfaceAction): ApplyResult {
  const cur = FO.current(focusStore.get())
  if (!cur || cur.id !== a.target) return "stale"
  const tl = FO.liveTimeline(focusStore.get(), a.at)
  const p = tl ? FL.phase(tl, a.at) : null
  if (!p) return "stale"
  if (a.type === "pause") {
    if (p.status !== "running") return "stale"
    FO.pauseFocus()
  } else if (a.type === "resume") {
    if (p.status !== "paused") return "stale"
    FO.resumeFocus()
  } else if (a.type === "skip") {
    if (p.kind !== "break") return "stale"
    FO.skipBreak()
  } else if (a.type === "finish") FO.stopFocus()
  else return "unknown"
  return "applied"
}

function timerAction(a: SurfaceAction): ApplyResult {
  const live = liveStore.get().live
  if (live?.kind === "focus") return focusAction(a)
  const timer = habitsStore.get().timer
  if (live?.kind !== "timer" || timer?.habitId !== a.target) return "stale"
  if (a.type === "pause") {
    if (live.pausedAt) return "stale"
    HA.pauseLive()
  } else if (a.type === "resume") {
    if (!live.pausedAt) return "stale"
    HA.resumeLive()
  } else if (a.type === "finish") {
    // Counted to the tap, not to whenever the app got to it.
    HA.finishTimer(elapsedSec(live, a.at) / 60)
  } else return "unknown"
  return "applied"
}

function workoutAction(a: SurfaceAction): ApplyResult {
  const s = fitStore.get()
  const w = s.workouts.find(
    (x) => x.id === a.target && x.status === "in_progress",
  )
  if (!w) return "stale"
  switch (a.type) {
    case "finishSet": {
      const [weId, setId] = (a.key ?? "").split("/")
      const set = w.exercises
        .find((e) => e.id === weId)
        ?.sets.find((x) => x.id === setId)
      if (!set || isDone(set)) return "stale"
      FA.toggleSet(w.id, weId, setId)
      return "applied"
    }
    case "skipRest":
      if (!s.rest) return "stale"
      FA.skipRest()
      return "applied"
    case "addRest":
      if (!s.rest) return "stale"
      FA.adjustRest(30)
      return "applied"
    case "finish":
      FA.finishWorkout(w.id, { endAt: new Date(a.at).toISOString() })
      return "applied"
    default:
      return "unknown"
  }
}

function checkHabitAction(a: SurfaceAction): ApplyResult {
  const day = a.key ?? dayKey(new Date(a.at))
  if (HA.alreadyLogged(a.target, day)) return "stale"
  return HA.checkHabit(a.target, day, "tap") ? "applied" : "stale"
}

export function applySurfaceAction(a: SurfaceAction): ApplyResult {
  if (a.type === "checkHabit") return checkHabitAction(a)
  if (a.kind === "routine") return routineAction(a)
  if (a.kind === "timer") return timerAction(a)
  if (a.kind === "workout") return workoutAction(a)
  return "unknown"
}

/** Applies queued actions oldest first; returns how many changed a store. */
export function applySurfaceActions(actions: SurfaceAction[]): number {
  let applied = 0
  for (const a of [...actions].sort((x, y) => x.at - y.at))
    if (applySurfaceAction(a) === "applied") applied++
  return applied
}

/** Applies every queued lock-screen or widget tap. */
export function drainSurfaceActions(): number {
  const queued = drainActions()
  return queued.length ? applySurfaceActions(queued) : 0
}
