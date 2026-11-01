// Runs, walks and the calorie estimates. Pure: the GPS track, its pauses
// and the person's weight in, distance, splits, pace, climb and kcal out.
//
// Calories are ACTIVE kcal (resting metabolism left out), the figure Apple
// Health calls Active Energy, so the two can be compared:
//   - on foot (a run or walk, or a timed set with a speed): the ACSM
//     metabolic equations, net of rest. v in m/min, grade the rise over the
//     distance (0 to 15%; downhill counts as flat):
//       walking (under 8 km/h)  VO2 = 0.1·v + 1.8·v·grade
//       running                 VO2 = 0.2·v + 0.9·v·grade
//     kcal = VO2 (ml/kg/min) × kg × minutes / 1000 × 5 kcal per litre O2.
//   - lifting: the session's time not spent on timed cardio sets, capped at
//     3 hours, at MET 3.5 (resistance training, moderate) or 5.0 (vigorous)
//     when it averaged 3 or more working sets per 10 minutes (Compendium of
//     Physical Activities, 2024). Active kcal = (MET − 1) × kg × hours. A
//     workout logged in chat has no real clock: 2.5 minutes per working set.
// The server's calc.estimate_workout_kcal implements the same constants
// for workouts finished away from this phone.

import type {
  FitnessState,
  RunKind,
  RunPoint,
  RunSession,
  RunSplit,
  Workout,
} from "./data"

/** Weight used when the person has never weighed in. */
export const DEFAULT_WEIGHT_KG = 70
/** Fixes less certain than this are dropped (metres). */
export const MAX_ACCURACY_M = 30
/** Faster than this between two fixes is a GPS jump, not a person (m/s). */
export const MAX_SPEED_MS: Record<RunKind, number> = { run: 12, walk: 7 }
/** Most points kept on a finished route (the server's limit). */
export const MAX_ROUTE_POINTS = 5000
/** A gap longer than this between fixes (lost signal) adds distance but
 * no calories or pace: nothing says how it was covered (seconds). */
const GAP_SEC = 60
const WALK_RUN_KMH = 8

export const runsOf = (s: Pick<FitnessState, "runs">): RunSession[] =>
  s.runs ?? []

// ------------------------------------------------------------------ geometry

const R = 6_371_000
const rad = (d: number) => (d * Math.PI) / 180
/** Great-circle distance in metres. */
export function haversineM(a: RunPoint, b: RunPoint): number {
  const dLat = rad(b[0] - a[0]),
    dLng = rad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A pause, in seconds since the start; an open one has no end yet. */
export type Pause = [number, number | null]

/** Whether the segment between two fixes runs through a pause: its
 * distance was not moved under the clock, so it is left out. */
export function acrossPause(pauses: Pause[], t0: number, t1: number) {
  return pauses.some(([a, b]) => a < t1 && (b === null || b > t0))
}

/** Moving seconds at `t` (session seconds): paused time removed. */
export function movingAt(pauses: Pause[], t: number): number {
  let paused = 0
  for (const [a, b] of pauses) {
    if (a >= t) continue
    paused += Math.min(t, b ?? t) - a
  }
  return Math.max(0, t - paused)
}

/** Whether a new fix belongs on the track: accurate enough, after the
 * last one, and not a jump no runner could make. */
export function acceptFix(
  prev: RunPoint | undefined,
  next: RunPoint,
  accuracy: number | null | undefined,
  kind: RunKind,
): boolean {
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return false
  if (!prev) return true
  const dt = next[3] - prev[3]
  if (dt <= 0) return false
  return haversineM(prev, next) / dt <= MAX_SPEED_MS[kind]
}

// ------------------------------------------------------------------ summary

export interface RunSummary {
  distanceM: number
  splits: RunSplit[]
  /** Climb in metres, 3 m steps ignored as GPS noise; null without
   * altitude. */
  elevationGainM: number | null
}

const ELEV_NOISE_M = 3

export function summarize(points: RunPoint[], pauses: Pause[]): RunSummary {
  let dist = 0,
    nextKm = 1000,
    lastSplitMoving = 0,
    lastSplitAlt: number | null = points[0]?.[2] ?? null,
    gain = 0,
    base: number | null = null,
    sawAlt = false
  const splits: RunSplit[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p[2] !== null) {
      sawAlt = true
      if (base === null) base = p[2]
      else if (p[2] - base >= ELEV_NOISE_M) {
        gain += p[2] - base
        base = p[2]
      } else if (base - p[2] >= ELEV_NOISE_M) base = p[2]
    }
    if (i === 0) continue
    const q = points[i - 1]
    if (acrossPause(pauses, q[3], p[3])) continue
    const d = haversineM(q, p)
    while (d > 0 && dist + d >= nextKm) {
      // Where along this segment the kilometre was crossed.
      const f = (nextKm - dist) / d
      const t = q[3] + f * (p[3] - q[3])
      const moving = movingAt(pauses, t)
      const alt =
        q[2] !== null && p[2] !== null ? q[2] + f * (p[2] - q[2]) : null
      splits.push({
        km: splits.length + 1,
        sec: Math.round(moving - lastSplitMoving),
        elevM:
          alt !== null && lastSplitAlt !== null
            ? Math.round(alt - lastSplitAlt)
            : null,
      })
      lastSplitMoving = moving
      lastSplitAlt = alt
      nextKm += 1000
    }
    dist += d
  }
  return {
    distanceM: dist,
    splits,
    elevationGainM: sawAlt ? Math.round(gain) : null,
  }
}

/** Seconds per kilometre; null below 20 m, where pace means nothing. */
export function paceSecPerKm(movingSec: number, distanceM: number) {
  return distanceM >= 20 ? (movingSec / distanceM) * 1000 : null
}

/** A pace from fixes older than this is no longer "now" (seconds). */
const STALE_SEC = 15

/** Pace over the last `windowSec` moving seconds, from the track; null
 * when the last fix is more than 15 s before `nowSec` (no signal). */
export function currentPace(
  points: RunPoint[],
  pauses: Pause[],
  windowSec = 30,
  nowSec?: number,
): number | null {
  const last = points.at(-1)
  if (!last) return null
  if (nowSec !== undefined && nowSec - last[3] > STALE_SEC) return null
  let d = 0,
    from = last[3]
  for (let i = points.length - 1; i > 0; i--) {
    const p = points[i],
      q = points[i - 1]
    if (last[3] - q[3] > windowSec) break
    if (acrossPause(pauses, q[3], p[3])) break
    d += haversineM(q, p)
    from = q[3]
  }
  const sec = movingAt(pauses, last[3]) - movingAt(pauses, from)
  return sec > 0 ? paceSecPerKm(sec, d) : null
}

/** Keeps at most `max` points, evenly, always the first and last. */
export function thin(points: RunPoint[], max = MAX_ROUTE_POINTS): RunPoint[] {
  if (points.length <= max) return points
  const out: RunPoint[] = []
  const step = (points.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)])
  return out
}

// ------------------------------------------------------------------ calories

/** Net (active) oxygen cost of moving at `mPerMin` up `grade`, ml/kg/min. */
export function footVo2(mPerMin: number, grade = 0): number {
  const g = Math.min(0.15, Math.max(0, grade))
  return mPerMin * 60 < WALK_RUN_KMH * 1000
    ? 0.1 * mPerMin + 1.8 * mPerMin * g
    : 0.2 * mPerMin + 0.9 * mPerMin * g
}
const kcalOf = (vo2: number, kg: number, minutes: number) =>
  ((vo2 * kg * minutes) / 1000) * 5

/** Active kcal of a GPS track, segment by segment. */
export function runKcal(
  points: RunPoint[],
  pauses: Pause[],
  weightKg: number,
): number {
  let kcal = 0
  for (let i = 1; i < points.length; i++) {
    const p = points[i],
      q = points[i - 1]
    const dt = p[3] - q[3]
    if (dt <= 0 || dt > GAP_SEC || acrossPause(pauses, q[3], p[3])) continue
    const d = haversineM(q, p)
    if (d <= 0) continue
    const grade = q[2] !== null && p[2] !== null ? (p[2] - q[2]) / d : 0
    kcal += kcalOf(footVo2((d / dt) * 60, grade), weightKg, dt / 60)
  }
  return Math.round(kcal)
}

/** The latest weigh-in at or before `at`, else the latest at all, else
 * DEFAULT_WEIGHT_KG; `assumed` when there was none. */
export function weightAt(
  s: Pick<FitnessState, "weighIns">,
  at: string,
): { kg: number; assumed: boolean } {
  const sorted = [...s.weighIns].sort((a, b) =>
    a.measuredAt.localeCompare(b.measuredAt),
  )
  const before = sorted.filter((w) => w.measuredAt <= at).at(-1)
  const any = before ?? sorted.at(-1)
  return any
    ? { kg: any.weightKg, assumed: false }
    : { kg: DEFAULT_WEIGHT_KG, assumed: true }
}

const STRENGTH_CAP_MIN = 180
const CHAT_MIN_PER_SET = 2.5

/** Active kcal of a workout (see the method at the top of this file). */
export function workoutKcal(
  s: Pick<FitnessState, "weighIns">,
  w: Pick<Workout, "startedAt" | "endedAt" | "exercises" | "source"> & {
    cardio?: { km?: number; min?: number } | null
  },
): number {
  const kg = weightAt(s, w.startedAt).kg
  let kcal = 0,
    cardioMin = 0,
    working = 0,
    anyDone = false
  for (const e of w.exercises)
    for (const x of e.sets) {
      if (!x.completedAt) continue
      anyDone = true
      if (x.durationSec && x.speedKmh) {
        const min = x.durationSec / 60
        cardioMin += min
        kcal += kcalOf(footVo2((x.speedKmh * 1000) / 60), kg, min)
      } else if (x.kind !== "warmup" && !x.durationSec) working++
    }
  const chat = w.source === "chat"
  const c = w.cardio
  if (chat && c?.km && c.min) {
    anyDone = true
    kcal += kcalOf(footVo2((c.km * 1000) / c.min), kg, c.min)
  }
  if (!anyDone) return 0
  const sessionMin = w.endedAt
    ? (new Date(w.endedAt).getTime() - new Date(w.startedAt).getTime()) / 60_000
    : 0
  const rest = Math.min(
    STRENGTH_CAP_MIN,
    Math.max(0, chat ? working * CHAT_MIN_PER_SET : sessionMin - cardioMin),
  )
  const density = (working / Math.max(rest, 1)) * 10
  const met = density >= 3 ? 5 : 3.5
  kcal += ((met - 1) * kg * rest) / 60
  return Math.round(kcal)
}

// ------------------------------------------------------------------ display

/** "5.42" (km, two decimals; whole hundreds of metres below 1 km read
 * the same way: "0.40"). */
export const fmtKm = (m: number) => (Math.max(0, m) / 1000).toFixed(2)
/** "5:31" per km; "–:––" when there is no pace yet. */
export function fmtPace(secPerKm: number | null): string {
  if (secPerKm === null || !Number.isFinite(secPerKm) || secPerKm > 5999)
    return "–:––"
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
/** "1:02:15" or "42:07": a moving clock. */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    r = s % 60
  const mm = String(m).padStart(h ? 2 : 1, "0"),
    ss = String(r).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
/** A total of time as a figure and its unit: ["2:06", "h"] or
 * ["47", "min"], short enough for a third of a phone. */
export function hoursFigure(sec: number): [string, string] {
  const m = Math.round(Math.max(0, sec) / 60)
  if (m < 60) return [String(m), "min"]
  return [`${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`, "h"]
}
export const kindLabel = (k: RunKind) => (k === "run" ? "Run" : "Walk")

/** "Morning run", "Evening walk": what a session is called until renamed. */
export function defaultRunName(kind: RunKind, at: Date): string {
  const h = at.getHours()
  const part =
    h < 5
      ? "Night"
      : h < 12
        ? "Morning"
        : h < 17
          ? "Afternoon"
          : h < 21
            ? "Evening"
            : "Night"
  return `${part} ${kind}`
}

/** Totals over a set of sessions (a week of history). */
export function runTotals(runs: RunSession[]) {
  let distanceM = 0,
    movingSec = 0,
    kcal = 0
  for (const r of runs) {
    distanceM += r.distanceM
    movingSec += r.movingSec
    kcal += r.kcal ?? 0
  }
  return { count: runs.length, distanceM, movingSec, kcal }
}
