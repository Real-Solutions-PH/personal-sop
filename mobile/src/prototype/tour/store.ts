// The guided tour's saved state and the one-time tips, kept per account on
// this phone so neither repeats for the same person. A second account on
// the same phone gets its own. (Not synced: a new phone shows the tips
// once more; the tour itself only starts after first-run onboarding.)
import { createStore } from "@domain/lib/store"
import { type FunnelStep, logFunnel } from "../funnel"
import { sessionStore } from "../session"
import {
  IDLE,
  type TourEvent,
  type TourNote,
  type TourState,
  tourReducer,
} from "./machine"

/** Deep screens that explain themselves once, the first time they open. */
export const TIPS = ["finance", "nutrition", "habit"] as const
export type TipId = (typeof TIPS)[number]

export type UserTour = {
  tour: TourState
  /** Start the tour the next time Today shows (first run, or a replay). */
  queued: boolean
  tips: TipId[]
}

const EMPTY: UserTour = { tour: IDLE, queued: false, tips: [] }

export const tourStore = createStore<{ users: Record<string, UserTour> }>(
  "tour",
  () => ({ users: {} }),
)

/** Whose tour: the signed-in account, or this phone before there is one. */
export function tourUser(): string {
  const u = sessionStore.get().user
  return (u?.email || u?.username || "local").toLowerCase()
}

export const tourOf = (key = tourUser()): UserTour =>
  tourStore.get().users[key] ?? EMPTY

/** The signed-in person's tour, for screens. */
export function useTour(): UserTour {
  const key = sessionStore.use((s) =>
    (s.user?.email || s.user?.username || "local").toLowerCase(),
  )
  return tourStore.use((s) => s.users[key] ?? EMPTY)
}

function edit(f: (u: UserTour) => UserTour) {
  const key = tourUser()
  tourStore.set((s) => ({
    users: { ...s.users, [key]: f(s.users[key] ?? EMPTY) },
  }))
}

const FUNNEL: Record<TourNote["outcome"], "step_view" | "step_complete" | "step_skip"> =
  { view: "step_view", done: "step_complete", skip: "step_skip" }

export function dispatchTour(e: TourEvent) {
  const { state, notes } = tourReducer(tourOf().tour, e)
  if (state === tourOf().tour) return
  edit((u) => ({ ...u, tour: state }))
  for (const n of notes)
    logFunnel({
      event: FUNNEL[n.outcome],
      step: `tour_${n.step}` as FunnelStep,
    })
}

/** First run's end, or "Replay the tour": starts on Today. */
export function queueTour() {
  edit((u) => ({ ...u, queued: true }))
}

/** Starts a queued tour; true when it started. */
export function startQueuedTour(): boolean {
  const u = tourOf()
  if (!u.queued) return false
  edit((x) => ({ ...x, queued: false }))
  // A replay restarts a tour that ended; one already running carries on.
  if (u.tour.status !== "running") dispatchTour({ type: "start" })
  return true
}

export const tipSeen = (id: TipId) => tourOf().tips.includes(id)

export function markTip(id: TipId) {
  if (tipSeen(id)) return
  edit((u) => ({ ...u, tips: [...u.tips, id] }))
}

/** "Show tips again" in Me → Help. */
export function resetTips() {
  edit((u) => ({ ...u, tips: [] }))
}
