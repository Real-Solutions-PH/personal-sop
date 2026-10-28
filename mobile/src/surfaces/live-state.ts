import { isDone, isTimed, isWorking, setSeconds } from "@domain/fitness/calc"
import type { FitnessState, Workout } from "@domain/fitness/data"
import { liveTimeline } from "@domain/focus/actions"
import type { FocusState } from "@domain/focus/data"
import * as FL from "@domain/focus/logic"
import type { HabitsState, RoutineRun } from "@domain/habits/data"
import * as H from "@domain/habits/logic"
import { dayKey } from "@domain/lib/day"
import { elapsedSec, type Live } from "@domain/lib/live"
import { displayMass } from "@/prototype/units"
import type { LiveNext, LiveState } from "./types"

// The running routine, workout or habit timer as the lock screen shows it.
// Built from the same stores the in-app player reads; null when nothing runs.

// ActivityKit caps a content update at 4 KB; eight short rows stay well under.
const NEXT_MAX = 8
const ms = (iso: string) => new Date(iso).getTime()

function routineState(
  live: Live,
  s: HabitsState,
  now: number,
): LiveState | null {
  const today = dayKey(new Date(now))
  const r = s.routines.find(
    (x) => live.href === `/habits/routines/${x.id}/play`,
  )
  const run = r
    ? [...s.runs]
        .reverse()
        .find(
          (x: RoutineRun) =>
            x.routineId === r.id &&
            x.day === today &&
            x.state === "in_progress",
        )
    : undefined
  if (!r || !run) return null
  const habit = (i: number) =>
    s.habits.find((h) => h.id === run.steps[i]?.habitId)
  const step = run.steps[run.current]
  if (!step) return null
  const h = habit(run.current)
  const planned = step.minutes * 60 + run.stepBonusSec
  const stepElapsed = H.stepElapsed(run, now)
  const paused = !!run.pausedAt
  const total =
    ((paused && run.pausedAt ? ms(run.pausedAt) : now) - ms(run.startedAt)) /
    1000
  const next: LiveNext[] = []
  for (
    let i = run.current + 1;
    i < run.steps.length && next.length < NEXT_MAX;
    i++
  ) {
    const nh = habit(i)
    next.push({
      key: String(i),
      label: nh ? `${nh.icon} ${nh.name}` : "Step",
      detail: `Step ${i + 1} of ${run.steps.length} · ${run.steps[i].minutes} min`,
      sec: run.steps[i].minutes * 60,
    })
  }
  const remaining = Math.max(0, planned - stepElapsed)
  return {
    kind: "routine",
    id: run.id,
    title: r.name,
    icon: r.icon,
    step: h ? `${h.icon} ${h.name}` : "Step",
    detail: `Step ${run.current + 1} of ${run.steps.length} · ${step.minutes} min`,
    key: String(run.current),
    index: run.current,
    count: run.steps.length,
    paused,
    startedAt: ms(run.startedAt),
    elapsedSec: Math.round(total),
    ...(planned > 0
      ? paused
        ? { remainingSec: Math.round(remaining) }
        : {
            stepEndsAt:
              ms(run.stepStartedAt) + (run.stepPausedSec + planned) * 1000,
          }
      : {}),
    restSec: 0,
    next,
    controls: ["done", "skip", paused ? "resume" : "pause"],
    href: live.href,
  }
}

function timerState(live: Live, s: HabitsState, now: number): LiveState | null {
  const t = s.timer
  const h = t && s.habits.find((x) => x.id === t.habitId)
  if (!t || !h) return null
  const paused = !!live.pausedAt
  const elapsed = elapsedSec(live, now)
  const target = t.targetSec ?? 0
  const remaining = Math.max(0, target - elapsed)
  return {
    kind: "timer",
    id: h.id,
    title: h.name,
    icon: h.icon,
    step: `${h.icon} ${h.name}`,
    detail: target ? `Goal ${Math.round(target / 60)} min` : "Timer",
    key: h.id,
    index: 0,
    count: 0,
    paused,
    // Deterministic while running, so re-renders do not push updates.
    startedAt: Math.round(ms(live.startedAt) + (live.pausedSec ?? 0) * 1000),
    elapsedSec: Math.round(elapsed),
    ...(target && remaining > 0
      ? paused
        ? { remainingSec: Math.round(remaining) }
        : {
            stepEndsAt: Math.round(
              ms(live.startedAt) + ((live.pausedSec ?? 0) + target) * 1000,
            ),
          }
      : {}),
    restSec: 0,
    next: [],
    controls: [paused ? "resume" : "pause", "finish"],
    href: live.href,
  }
}

function setLabel(
  s: FitnessState,
  w: Workout,
  weId: string,
  setId: string,
): { label: string; detail: string } {
  const we = w.exercises.find((e) => e.id === weId)
  const ex = s.exercises.find((e) => e.id === we?.exerciseId)
  const working = we?.sets.filter(isWorking) ?? []
  const set = we?.sets.find((x) => x.id === setId)
  const n = working.findIndex((x) => x.id === setId) + 1
  const what = !set
    ? ""
    : isTimed(ex)
      ? `${Math.round(setSeconds(set) / 60)} min`
      : set.weight > 0
        ? `${displayMass(set.weight, set.unit ?? s.settings.units)} ${set.unit ?? s.settings.units} × ${set.reps}`
        : `${set.reps} reps`
  const which =
    set?.kind === "warmup" ? "Warm-up" : `Set ${n} of ${working.length}`
  return {
    label: ex?.name ?? "Exercise",
    detail: what ? `${which} · ${what}` : which,
  }
}

function workoutState(
  s: FitnessState,
  live: Live,
  now: number,
): LiveState | null {
  const w = s.workouts.find(
    (x) => x.id === s.activeId && x.status === "in_progress",
  )
  if (!w) return null
  const pending = w.exercises.flatMap((e) =>
    e.sets.filter((x) => !isDone(x)).map((x) => ({ we: e.id, set: x.id })),
  )
  const working = w.exercises.flatMap((e) => e.sets.filter(isWorking))
  const doneSets = working.filter(isDone).length
  const cur = pending[0]
  const restEndsAt = s.rest ? ms(s.rest.endsAt) : undefined
  const resting = restEndsAt !== undefined && restEndsAt > now
  const head = cur
    ? setLabel(s, w, cur.we, cur.set)
    : { label: "All sets done", detail: "Finish when you're ready" }
  const elapsed = Math.max(0, (now - ms(w.startedAt)) / 1000)
  return {
    kind: "workout",
    id: w.id,
    title: w.name,
    icon: "🏋️",
    step: head.label,
    detail: head.detail,
    key: cur ? `${cur.we}/${cur.set}` : "",
    index: doneSets,
    count: working.length,
    paused: false,
    startedAt: ms(w.startedAt),
    elapsedSec: Math.round(elapsed),
    ...(resting ? { restEndsAt } : {}),
    restSec: s.settings.restSec,
    next: pending.slice(1, NEXT_MAX + 1).map((p) => ({
      key: `${p.we}/${p.set}`,
      ...setLabel(s, w, p.we, p.set),
    })),
    // Resting: the in-app rest controls (four fit the lock screen).
    controls: resting
      ? ["subRest", "addRest", "skipRest", "finish"]
      : [...(cur ? (["finishSet"] as const) : []), "finish"],
    href: live.href,
  }
}

/** A focus session, drawn by the native timer layout (ADR-0025): a
 * Pomodoro counts down to the end of its set or break, a stopwatch counts
 * up. The id is the session's, so a tap is checked against it. */
function focusState(live: Live, s: FocusState, now: number): LiveState | null {
  const tl = liveTimeline(s, now)
  if (!tl) return null
  const p = FL.phase(tl, now)
  const paused = p.status !== "running"
  const pomodoro = tl.sess.mode === "pomodoro"
  const sets = tl.sess.setsBeforeLong
  const title = p.item?.title ?? "Focus"
  const step =
    p.status === "waiting"
      ? p.kind === "break"
        ? `Set ${p.setIndex + 1} done`
        : "Break over"
      : p.kind === "break"
        ? p.longBreak
          ? "Long break"
          : "Break"
        : pomodoro
          ? `Set ${(p.setIndex % sets) + 1} of ${sets}`
          : "Stopwatch"
  const remaining = p.remaining ?? 0
  return {
    kind: "timer",
    id: tl.sess.id,
    title,
    icon: "⏱",
    step,
    detail: `${FL.fmtHm(FL.focusSec(tl, now))} focused`,
    key: `${p.kind}-${p.setIndex}-${p.status}`,
    index: pomodoro ? p.setIndex % sets : 0,
    count: pomodoro ? sets : 0,
    paused,
    // Where the phase's clock reads zero, pauses excluded; deterministic
    // while running so re-renders do not push updates.
    startedAt: paused ? tl.sess.start : Math.round(now - p.elapsed * 1000),
    elapsedSec: Math.round(p.elapsed),
    ...(p.plannedSec
      ? paused
        ? { remainingSec: Math.round(remaining) }
        : { stepEndsAt: Math.round(now + remaining * 1000) }
      : {}),
    restSec: 0,
    next: [],
    controls:
      p.kind === "break"
        ? ["skip", "finish"]
        : [paused ? "resume" : "pause", "finish"],
    href: live.href,
  }
}

export function buildLiveState(input: {
  live: Live | null
  habits: HabitsState
  fit: FitnessState
  focus?: FocusState
  now?: number
}): LiveState | null {
  const { live } = input
  if (!live) return null
  const now = input.now ?? Date.now()
  if (live.kind === "focus")
    return input.focus ? focusState(live, input.focus, now) : null
  if (live.kind === "routine") return routineState(live, input.habits, now)
  if (live.kind === "timer") return timerState(live, input.habits, now)
  return workoutState(input.fit, live, now)
}

/** What a Live Activity update must carry; changes in clock-only fields
 * (elapsed seconds) do not need a push, the native timers count. */
export const liveKey = (s: LiveState | null) =>
  s ? JSON.stringify({ ...s, elapsedSec: undefined }) : ""
