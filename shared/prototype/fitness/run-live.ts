// The run or walk in progress. It lives on this device only, in its own
// store, until it is finished: a GPS fix every few metres would otherwise
// be a sync write each, and the finished session carries the whole track
// once. It holds no Live slot (lib/live), so it runs beside a workout,
// routine or focus session; the Live bar and the lock screen list it on
// its own row.

import { createStore, uid } from "../lib/store"
import type { RunKind, RunPoint, RunSession } from "./data"
import {
  acceptFix,
  defaultRunName,
  movingAt,
  type Pause,
  runKcal,
  summarize,
  thin,
  weightAt,
} from "./runs"
import { fitStore } from "./store"

export interface ActiveRun {
  id: string
  kind: RunKind
  /** ISO; every point's and pause's seconds count from here. */
  startedAt: string
  points: RunPoint[]
  pauses: Pause[]
  /** Latest reading from Apple Health for the session so far. */
  steps?: number
  hr?: { avg: number; max: number; last: number }
  /** The last fix's accuracy in metres, for the GPS signal chip. */
  accuracy?: number
  /** False when only a foreground watch could start: the route stops
   * recording while the screen is locked, and the screen says so. */
  background?: boolean
}

export const runLiveStore = createStore<{ active: ActiveRun | null }>(
  "run-live",
  () => ({ active: null }),
)

const sec = (r: ActiveRun, at: number) =>
  Math.max(0, (at - new Date(r.startedAt).getTime()) / 1000)

export const isPaused = (r: ActiveRun) => r.pauses.at(-1)?.[1] === null

/** Seconds since the start at `now` (pauses included): a fix's clock. */
export const sessionSec = (r: ActiveRun, now = Date.now()) => sec(r, now)

/** Moving seconds at `now`. */
export const movingSec = (r: ActiveRun, now = Date.now()) =>
  movingAt(r.pauses, sec(r, now))

export function startRun(kind: RunKind, now = Date.now()): ActiveRun {
  const cur = runLiveStore.get().active
  if (cur) return cur
  const r: ActiveRun = {
    id: uid(),
    kind,
    startedAt: new Date(now).toISOString(),
    points: [],
    pauses: [],
  }
  runLiveStore.set({ active: r })
  return r
}

const patch = (fn: (r: ActiveRun) => ActiveRun) =>
  runLiveStore.set((s) => (s.active ? { active: fn(s.active) } : s))

export function pauseRun(now = Date.now()) {
  patch((r) =>
    isPaused(r) ? r : { ...r, pauses: [...r.pauses, [sec(r, now), null]] },
  )
}
export function resumeRun(now = Date.now()) {
  patch((r) => {
    const last = r.pauses.at(-1)
    if (!last || last[1] !== null) return r
    return {
      ...r,
      pauses: [...r.pauses.slice(0, -1), [last[0], sec(r, now)]],
    }
  })
}
export function setRunKind(kind: RunKind) {
  patch((r) => ({ ...r, kind }))
}

export interface Fix {
  lat: number
  lng: number
  alt: number | null
  accuracy: number | null
  /** Epoch ms of the fix. */
  at: number
}

/** Adds fixes (from the foreground watch or the background task). Fixes
 * while paused only update the signal; jumps and blurry fixes are dropped. */
export function addFixes(fixes: Fix[]) {
  if (!fixes.length) return
  patch((r) => {
    let points = r.points
    let accuracy = r.accuracy
    for (const f of [...fixes].sort((a, b) => a.at - b.at)) {
      accuracy = f.accuracy ?? accuracy
      if (isPaused(r)) continue
      const t = sec(r, f.at)
      const p: RunPoint = [f.lat, f.lng, f.alt, Math.round(t * 10) / 10]
      if (!acceptFix(points.at(-1), p, f.accuracy, r.kind)) continue
      if (points === r.points) points = [...points, p]
      else points.push(p)
    }
    return points === r.points && accuracy === r.accuracy
      ? r
      : { ...r, points, ...(accuracy != null ? { accuracy } : {}) }
  })
}

export function setRunTracking(background: boolean) {
  patch((r) => (r.background === background ? r : { ...r, background }))
}

export function setRunHealth(h: Pick<ActiveRun, "steps" | "hr">) {
  patch((r) => ({ ...r, ...h }))
}

/** The session as it would be saved now. */
export function snapshotRun(r: ActiveRun, now = Date.now()): RunSession {
  const end = sec(r, now)
  // A pause still open at the finish ends at the finish.
  const pauses: Pause[] = r.pauses.map(([a, b]) => [a, b ?? end])
  const sum = summarize(r.points, pauses)
  const weight = weightAt(fitStore.get(), r.startedAt).kg
  return {
    id: r.id,
    kind: r.kind,
    name: defaultRunName(r.kind, new Date(r.startedAt)),
    startedAt: r.startedAt,
    endedAt: new Date(now).toISOString(),
    movingSec: Math.round(movingAt(pauses, end)),
    distanceM: Math.round(sum.distanceM),
    ...(sum.elevationGainM !== null
      ? { elevationGainM: sum.elevationGainM }
      : {}),
    ...(r.steps != null ? { steps: r.steps } : {}),
    ...(r.hr ? { avgHr: r.hr.avg, maxHr: r.hr.max } : {}),
    kcal: runKcal(r.points, pauses, weight),
    route: thin(r.points),
    splits: sum.splits,
  }
}

type Finished = (r: RunSession) => void
const finished = new Set<Finished>()
export function onRunFinished(cb: Finished): () => void {
  finished.add(cb)
  return () => finished.delete(cb)
}

/** Saves the session to history (and so to sync) and clears it. */
export function finishRun(now = Date.now()): RunSession | null {
  const r = runLiveStore.get().active
  if (!r) return null
  const done = snapshotRun(r, now)
  fitStore.set((s) => ({ ...s, runs: [...(s.runs ?? []), done] }))
  runLiveStore.set({ active: null })
  for (const cb of finished) cb(done)
  return done
}
export function discardRun() {
  runLiveStore.set({ active: null })
}

export function patchRun(id: string, fn: (r: RunSession) => RunSession) {
  fitStore.set((s) => ({
    ...s,
    runs: (s.runs ?? []).map((r) => (r.id === id ? fn(r) : r)),
  }))
}
export function deleteRun(id: string): RunSession | undefined {
  const r = (fitStore.get().runs ?? []).find((x) => x.id === id)
  fitStore.set((s) => ({
    ...s,
    runs: (s.runs ?? []).filter((x) => x.id !== id),
  }))
  return r
}
export function restoreRun(r: RunSession) {
  fitStore.set((s) => ({
    ...s,
    runs: [...(s.runs ?? []), r].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    ),
  }))
}
