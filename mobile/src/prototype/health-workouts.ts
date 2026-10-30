// Saving finished workouts to Apple Health, once the person turns it on in
// Fitness settings. Device-local and never synced: the Health permission
// and its samples belong to this phone, and Health itself syncs them to the
// person's other devices.
//
// Only workouts finished on this phone after the switch went on are saved;
// chat-logged ones (a placeholder time) and ones that arrive by sync are
// not. A saved workout's Health sample is removed when the workout is
// deleted here, and only once a reconcile pass has seen it present: absence
// alone (a blank or half-pulled store) never deletes anything.

import { onWorkoutFinished } from "@domain/fitness/actions"
import { isTimed } from "@domain/fitness/calc"
import type { Workout } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { createStore } from "@domain/lib/store"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { syncReady } from "@/live/ready"
import { canWriteWorkouts, deleteSavedWorkout, saveWorkout } from "./health"

export interface SavedWorkout {
  /** The Health sample's uuid. */
  uuid: string
  /** A reconcile pass (or the save itself) saw the workout present. */
  seen: boolean
}

/** Keyed by the signed-in account: signing in as someone else on this phone
 * empties the stores, and an unkeyed record would then read every earlier
 * account's workouts as deleted. */
export const healthWorkoutsStore = createStore("healthWorkouts", () => ({
  enabled: false,
  enabledAt: null as string | null,
  saved: {} as Record<string, Record<string, SavedWorkout>>,
  /** The latest workout ids finished on this phone, for the retry. */
  finishedHere: {} as Record<string, string[]>,
}))

/** Longer than the delete toast's undo window. */
export const RECONCILE_MS = 10_000
const FINISHED_KEEP = 50
const RETRY_WINDOW_MS = 24 * 3_600_000

function owner(): string | null {
  if (!liveMode) return "local"
  return (
    require("@/live/runtime") as typeof import("@/live/runtime")
  ).liveOwner()
}

const gateOpen = () => !!owner() && syncReady.getState().ready

function setEntry(who: string, id: string, entry: SavedWorkout | null) {
  healthWorkoutsStore.set((s) => {
    const mine = { ...s.saved[who] }
    if (entry) mine[id] = entry
    else delete mine[id]
    return { ...s, saved: { ...s.saved, [who]: mine } }
  })
}

/** Every exercise a timed cardio one: Health's mixed cardio. */
function cardioOnly(w: Workout) {
  const byId = new Map(fitStore.get().exercises.map((e) => [e.id, e]))
  return (
    w.exercises.length > 0 &&
    w.exercises.every((we) => {
      const ex = byId.get(we.exerciseId)
      return isTimed(ex) && ex?.muscle === "cardio"
    })
  )
}

/** Loaded on use: Sentry is set up by the root layout, not here. */
function report(message: string) {
  try {
    ;(
      require("@sentry/react-native") as typeof import("@sentry/react-native")
    ).captureMessage(message)
  } catch {
    // No Sentry in this build: nothing else to tell.
  }
}

const saving = new Set<string>()

async function save(w: Workout) {
  const st = healthWorkoutsStore.get(),
    who = owner()
  if (!st.enabled || !who || w.source === "chat" || !w.endedAt) return
  if (st.saved[who]?.[w.id] || saving.has(w.id)) return
  // Revoked in the Health app: skipped; settings says so.
  if (!canWriteWorkouts()) return
  const start = new Date(w.startedAt),
    end = new Date(w.endedAt)
  if (!(end.getTime() >= start.getTime())) {
    report("Workout ends before it starts; not saved to Health")
    return
  }
  saving.add(w.id)
  const uuid = await saveWorkout({
    id: w.id,
    name: w.name,
    start,
    end,
    cardio: cardioOnly(w),
  })
  saving.delete(w.id)
  if (uuid) {
    // Present right now, so deleting it before the next pass still removes
    // the Health sample.
    setEntry(who, w.id, { uuid, seen: true })
    toast.success("Saved to Apple Health")
  } else toast.error("Couldn't save to Apple Health")
}

const deleting = new Set<string>()

/** Marks saved workouts that are present as seen, and removes the Health
 * sample of one seen earlier that is gone now. Runs only once this
 * account's state is known on this phone. */
export function reconcile() {
  const who = owner()
  if (!who || !syncReady.getState().ready) return
  const mine = healthWorkoutsStore.get().saved[who]
  if (!mine) return
  const present = new Set(
    fitStore
      .get()
      .workouts.filter((w) => w.status === "finished")
      .map((w) => w.id),
  )
  for (const [id, e] of Object.entries(mine)) {
    if (present.has(id)) {
      if (!e.seen) setEntry(who, id, { ...e, seen: true })
    } else if (e.seen && !deleting.has(e.uuid)) {
      deleting.add(e.uuid)
      void deleteSavedWorkout(e.uuid).then((ok) => {
        deleting.delete(e.uuid)
        // Kept when Health refused (a locked phone): the next pass retries.
        if (ok) setEntry(who, id, null)
      })
    }
  }
}

/** One more try at workouts finished here in the last day whose save
 * failed. */
function retry(who: string) {
  const st = healthWorkoutsStore.get()
  if (!st.enabled || !st.enabledAt) return
  const here = new Set(st.finishedHere[who] ?? [])
  const since = Date.now() - RETRY_WINDOW_MS
  for (const w of fitStore.get().workouts)
    if (
      w.status === "finished" &&
      w.endedAt &&
      here.has(w.id) &&
      !st.saved[who]?.[w.id] &&
      new Date(w.endedAt).getTime() > since &&
      w.endedAt > st.enabledAt
    )
      void save(w)
}

/** Mounted once while the app runs; returns the unsubscribe. */
export function connectHealthWorkouts(): () => void {
  const off = onWorkoutFinished((w) => {
    const who = owner()
    if (!who || !healthWorkoutsStore.get().enabled) return
    healthWorkoutsStore.set((s) => ({
      ...s,
      finishedHere: {
        ...s.finishedHere,
        [who]: [
          ...(s.finishedHere[who] ?? []).filter((x) => x !== w.id),
          w.id,
        ].slice(-FINISHED_KEEP),
      },
    }))
    void save(w)
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  const later = () => {
    clearTimeout(timer)
    timer = setTimeout(reconcile, RECONCILE_MS)
  }
  const retried = new Set<string>()
  const opened = () => {
    const who = owner()
    if (!who || !gateOpen()) return
    later()
    if (!retried.has(who)) {
      retried.add(who)
      retry(who)
    }
  }
  const workouts = fitStore.subscribe(later)
  const ready = syncReady.subscribe(opened)
  opened()
  return () => {
    off()
    workouts()
    ready()
    clearTimeout(timer)
  }
}
