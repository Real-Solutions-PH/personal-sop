// What a body action just earned or cost, decided from the state before and
// after it: a set that beat the record, a run that set one, a meal that
// pushed the day over a limit or onto a goal, a weigh-in's step toward the
// goal weight, and last week's missed workout target. Pure, so the screens
// only decide how each one looks and feels.

import * as C from "@domain/fitness/calc"
import type {
  FitnessState,
  MacroTarget,
  RunSession,
  RunSplit,
  Workout,
} from "@domain/fitness/data"
import {
  dayDetail,
  fiberGoalFor,
  LIMIT_LABEL,
  type LimitKey,
  limitsFor,
} from "@domain/fitness/limits"
import * as R from "@domain/fitness/runs"
import { dayKey } from "@domain/lib/day"

// ------------------------------------------------------------------ PRs

/** The record the exercise ``weId`` holds in ``w`` (in progress) against
 * every finished workout, by kind, or none. */
function workoutPr(s: FitnessState, w: Workout, weId: string) {
  const we = w.exercises.find((x) => x.id === weId)
  if (!we) return undefined
  return C.allPrs(s, w).find(
    (p) => p.workoutId === w.id && p.exerciseId === we.exerciseId,
  )
}

/** The record a set just completed set: compared with the same workout a
 * moment before, so a heavier set after an earlier PR set counts again
 * while a lighter one does not. ``s`` is the state after the tick; the
 * workout before it is ``before``. */
export function newSetPr(
  s: FitnessState,
  before: Workout,
  after: Workout,
  weId: string,
): C.Pr | undefined {
  const now = workoutPr(s, after, weId)
  if (!now) return undefined
  const was = workoutPr(s, before, weId)
  if (!was) return now
  // allPrs reports one record per exercise per workout, its value the
  // first kind that moved; a new kind or a higher value is a new record.
  if (was.kind !== now.kind || now.value > was.value + 0.01) return now
  return undefined
}

// ------------------------------------------------------------------ runs

/** Below this a pace says little; a 300 m jog is not a record. */
const RECORD_MIN_M = 1000

export interface RunRecord {
  /** The best average pace of this kind (s/km), with the one it beat. */
  pace?: { sec: number; prev: number }
  /** The fastest kilometre of this kind, with the one it beat. */
  split?: { split: RunSplit; prev: number }
}

/** What ``run`` set against the earlier sessions of its kind. The first
 * session sets nothing: there is nothing yet to beat. */
export function runRecord(
  runs: RunSession[],
  run: RunSession,
): RunRecord | undefined {
  const earlier = runs.filter(
    (x) =>
      x.id !== run.id &&
      x.kind === run.kind &&
      // A treadmill pace is never an outdoor record, nor the reverse.
      !!x.indoor === !!run.indoor &&
      x.startedAt < run.startedAt,
  )
  if (!earlier.length) return undefined
  const out: RunRecord = {}
  const pace = (x: RunSession) =>
    x.distanceM >= RECORD_MIN_M
      ? R.paceSecPerKm(x.movingSec, x.distanceM)
      : null
  const mine = pace(run)
  const prev = earlier
    .map(pace)
    .filter((p): p is number => p !== null)
    .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
  if (mine !== null && Number.isFinite(prev) && mine < prev - 0.5)
    out.pace = { sec: mine, prev }
  const fastest = (x: RunSession) =>
    x.splits.reduce<RunSplit | undefined>(
      (a, b) => (!a || b.sec < a.sec ? b : a),
      undefined,
    )
  const best = fastest(run)
  const prevSplit = earlier
    .map(fastest)
    .filter((x): x is RunSplit => !!x)
    .reduce((a, b) => Math.min(a, b.sec), Number.POSITIVE_INFINITY)
  if (best && Number.isFinite(prevSplit) && best.sec < prevSplit - 0.5)
    out.split = { split: best, prev: prevSplit }
  return out.pace || out.split ? out : undefined
}

// ------------------------------------------------------------------ meals

export type OverKey = "kcal" | LimitKey

export interface Crossing {
  key: OverKey
  /** How far past the line the day now is, in the key's unit. */
  over: number
  /** "+180 kcal over", "+0.8 g over". */
  text: string
}

const unitOf = (k: OverKey) => (k === "kcal" ? "kcal" : LIMIT_LABEL[k].unit)
const amount = (n: number, unit: string) =>
  unit === "g" && n < 10
    ? String(Math.round(n * 10) / 10)
    : Math.round(n).toLocaleString("en-US")

export interface DayIntake {
  kcal: number
  protein: number
  fiber?: number
  satFat?: number
  sugar?: number
  sodium?: number
}

/** A day's intake as the totals and limit bars count it. */
export function dayIntake(s: FitnessState, day: string): DayIntake {
  const totals = C.dayTotals(s, day).totals
  return {
    kcal: totals.kcal,
    protein: totals.protein,
    ...dayDetail(C.mealsOn(s, day)),
  }
}

/** The lines a save carried the day across: calories past the target, a
 * limit past its max. A day already over stays quiet: the miss was told
 * when it happened. */
export function crossings(
  before: DayIntake,
  after: DayIntake,
  target: MacroTarget | undefined,
): Crossing[] {
  const lines: [OverKey, number | undefined][] = [
    ["kcal", target?.kcal],
    ...(Object.entries(limitsFor(target)) as [LimitKey, number][]),
  ]
  const out: Crossing[] = []
  for (const [key, max] of lines) {
    if (!max || max <= 0) continue
    const was = before[key] ?? 0,
      now = after[key] ?? 0
    if (was <= max && now > max) {
      const over = now - max,
        unit = unitOf(key)
      out.push({ key, over, text: `+${amount(over, unit)} ${unit} over` })
    }
  }
  return out
}

export type GoalKey = "protein" | "fiber"

/** The goals a save reached: protein or fiber passing its goal. */
export function goalsReached(
  before: DayIntake,
  after: DayIntake,
  target: MacroTarget | undefined,
): GoalKey[] {
  if (!target) return []
  const goals: [GoalKey, number][] = [
    ["protein", target.protein],
    ["fiber", fiberGoalFor(target)],
  ]
  return goals
    .filter(
      ([k, goal]) =>
        goal > 0 && (before[k] ?? 0) < goal && (after[k] ?? 0) >= goal,
    )
    .map(([k]) => k)
}

// ------------------------------------------------------------------ weight

export interface WeighStep {
  /** The new weigh-in, kg. */
  kg: number
  /** New weight minus the one before it, kg (0 on the first weigh-in). */
  deltaKg: number
  /** True toward the goal, false away from it, null with no goal or no
   * earlier weigh-in, or on maintain. */
  toward: boolean | null
  /** This weigh-in reached the goal weight the one before had not. */
  reached: boolean
  /** "▼0.3 kg toward goal", "▲0.2 kg since last". */
  text: string
}

/** What a new weigh-in of ``kg`` says next to the latest one before it. */
export function weighStep(
  s: Pick<FitnessState, "weighIns" | "settings">,
  kg: number,
  measuredAt: string,
): WeighStep | undefined {
  const prev = [...s.weighIns]
    .filter((x) => x.measuredAt < measuredAt)
    .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt))
    .at(-1)
  if (!prev) return undefined
  const delta = Math.round((kg - prev.weightKg) * 10) / 10
  const goal = s.settings.goalWeight,
    dir = s.settings.goalDirection
  const at = (w: number) =>
    goal !== undefined &&
    ((dir === "cut" && w <= goal) || (dir === "bulk" && w >= goal))
  const reached = at(kg) && !at(prev.weightKg)
  const toward =
    goal === undefined || dir === "maintain" || delta === 0
      ? null
      : (dir === "cut") === delta < 0
  const arrow = delta < 0 ? "▼" : delta > 0 ? "▲" : "•"
  const size = Math.abs(delta).toFixed(1)
  const text =
    delta === 0
      ? "Same as last"
      : toward === true
        ? `${arrow}${size} kg toward goal`
        : toward === false
          ? `${arrow}${size} kg away from goal`
          : `${arrow}${size} kg since last`
  return { kg, deltaKg: delta, toward, reached, text }
}

// ------------------------------------------------------------------ weeks

/** On the first day of a week, last week's sessions when they fell short
 * of the weekly target; otherwise undefined. */
export function lastWeekShort(
  s: FitnessState,
  today = dayKey(),
): { count: number; target: number } | undefined {
  const start = C.weekStart(today)
  if (start !== today) return undefined
  const target = s.settings.weeklyTarget
  if (!target) return undefined
  const from = C.addDays(start, -7)
  const count = C.finished(s).filter((w) => {
    const d = dayKey(new Date(w.startedAt))
    return d >= from && d < start
  }).length
  return count < target ? { count, target } : undefined
}
