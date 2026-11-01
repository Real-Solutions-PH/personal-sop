// GPS for a run or walk. On a phone the fixes come from a background
// location task, so the route keeps recording with the screen locked (iOS
// shows the blue location pill; Android an ongoing notification). Where
// there is no task manager (web, Expo Go, tests) a foreground watch is
// used instead. Fixes land in the run-live store; steps and heart rate
// are read from Apple Health for the session's window every 30 seconds
// while the app is open, and once more at the finish. A finished workout's
// steps come from the same window read.
//
// Location is only ever watched while a session is in progress.

import { onWorkoutFinished, updateWorkoutHealth } from "@domain/fitness/actions"
import {
  addFixes,
  type Fix,
  finishRun,
  onRunFinished,
  patchRun,
  runLiveStore,
  setRunHealth,
} from "@domain/fitness/run-live"
import { AppState, Platform } from "react-native"
import { connectHealth, healthAvailable, readWindow } from "./health"

type Location = typeof import("expo-location")
type TaskManager = typeof import("expo-task-manager")

export const RUN_TASK = "unfurl-run-location"
const HEALTH_EVERY_MS = 30_000

function load<T>(name: "expo-location" | "expo-task-manager"): T | null {
  try {
    return (
      name === "expo-location"
        ? require("expo-location")
        : require("expo-task-manager")
    ) as T
  } catch {
    return null // the native module is missing from this build
  }
}

interface RawLocation {
  coords: {
    latitude: number
    longitude: number
    altitude: number | null
    accuracy: number | null
  }
  timestamp: number
}
const toFix = (l: RawLocation): Fix => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  alt: l.coords.altitude,
  accuracy: l.coords.accuracy,
  at: l.timestamp,
})

/** Called once from the entry file, before anything renders: iOS may
 * relaunch the app in the background just to deliver fixes. */
export function registerRunTask() {
  if (Platform.OS === "web") return
  const TM = load<TaskManager>("expo-task-manager")
  if (!TM || TM.isTaskDefined(RUN_TASK)) return
  TM.defineTask<{ locations: RawLocation[] }>(RUN_TASK, async ({ data }) => {
    if (data?.locations?.length) addFixes(data.locations.map(toFix))
  })
}

export type TrackStart =
  | { ok: true; background: boolean }
  | { ok: false; reason: string }

let watch: { remove(): void } | null = null

/** Asks for location and starts recording fixes. */
export async function startTracking(kind: "run" | "walk"): Promise<TrackStart> {
  const L = load<Location>("expo-location")
  if (!L) return { ok: false, reason: "This build can't use location." }
  const fg = await L.requestForegroundPermissionsAsync().catch(() => null)
  if (fg?.status !== "granted")
    return {
      ok: false,
      reason: "Allow location for Unfurl in Settings to record your route.",
    }
  // Heart rate is a newer read: the Health sheet asks only for what is new.
  if (healthAvailable()) void connectHealth()
  const TM =
    Platform.OS === "web" ? null : load<TaskManager>("expo-task-manager")
  if (TM && (await TM.isAvailableAsync().catch(() => false))) {
    try {
      if (await L.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false))
        return { ok: true, background: true }
      await L.startLocationUpdatesAsync(RUN_TASK, {
        accuracy: L.Accuracy.BestForNavigation,
        activityType: L.ActivityType.Fitness,
        distanceInterval: 3,
        timeInterval: 2000,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle:
            kind === "run" ? "Recording your run" : "Recording your walk",
          notificationBody: "Unfurl is recording your route.",
          notificationColor: "#1f5a43",
        },
      })
      return { ok: true, background: true }
    } catch {
      // No background permission or capability: fall through to a watch.
    }
  }
  watch?.remove()
  watch = await L.watchPositionAsync(
    {
      accuracy: L.Accuracy.BestForNavigation,
      distanceInterval: 3,
      timeInterval: 2000,
    },
    (l) => addFixes([toFix(l as RawLocation)]),
  ).catch(() => null)
  return watch
    ? { ok: true, background: false }
    : { ok: false, reason: "Couldn't start location. Try again." }
}

export async function stopTracking() {
  watch?.remove()
  watch = null
  const L = load<Location>("expo-location")
  if (!L || Platform.OS === "web") return
  if (await L.hasStartedLocationUpdatesAsync(RUN_TASK).catch(() => false))
    await L.stopLocationUpdatesAsync(RUN_TASK).catch(() => {})
}

async function refreshHealth() {
  const r = runLiveStore.get().active
  if (!r || !healthAvailable()) return
  const h = await readWindow(new Date(r.startedAt), new Date())
  if (runLiveStore.get().active?.id !== r.id) return
  setRunHealth({
    ...(h.steps !== null ? { steps: h.steps } : {}),
    ...(h.hr ? { hr: h.hr } : {}),
  })
}

let started = false
/** Call once after sign-in: keeps tracking alive across relaunches while a
 * session is in progress, polls Health, and reads it once more for a
 * finished session (Health can lag the last minutes). */
export function startRunTracker() {
  if (started) return
  started = true
  let timer: ReturnType<typeof setInterval> | null = null
  const sync = () => {
    const active = runLiveStore.get().active
    if (active && !timer) {
      void startTracking(active.kind)
      void refreshHealth()
      timer = setInterval(() => {
        if (AppState.currentState === "active") void refreshHealth()
      }, HEALTH_EVERY_MS)
    } else if (!active && timer) {
      clearInterval(timer)
      timer = null
      void stopTracking()
    }
  }
  runLiveStore.subscribe(sync)
  sync()
  onRunFinished((run) => {
    if (!healthAvailable()) return
    void readWindow(new Date(run.startedAt), new Date(run.endedAt)).then((h) =>
      patchRun(run.id, (r) => ({
        ...r,
        ...(h.steps !== null ? { steps: h.steps } : {}),
        ...(h.hr ? { avgHr: h.hr.avg, maxHr: h.hr.max } : {}),
      })),
    )
  })
  onWorkoutFinished((w) => {
    // A chat-logged workout has a placeholder time: no real window.
    if (w.source === "chat" || !w.endedAt || !healthAvailable()) return
    workoutSteps(w.id, w.startedAt, w.endedAt)
  })
}

/** Health writes iPhone steps in batches, so a read right at the finish
 * can miss the last minutes: read again a little later. */
const LATE_READ_MS = 120_000

function workoutSteps(id: string, start: string, end: string) {
  const read = () =>
    readWindow(new Date(start), new Date(end)).then((h) => {
      if (h.steps !== null) updateWorkoutHealth(id, { steps: h.steps })
    })
  void read()
  setTimeout(() => void read(), LATE_READ_MS)
}

/** Finish and stop the GPS in one step (the screen's Finish button). */
export function finishAndStop() {
  const done = finishRun()
  void stopTracking()
  return done
}
