import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { finStore } from "@domain/finance/store"
import { runLiveStore } from "@domain/fitness/run-live"
import { fitStore } from "@domain/fitness/store"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { privacyStore } from "@domain/lib/privacy"
import { tasksStore } from "@domain/tasks/store"
import { useEffect, useRef, useState } from "react"
import { AppState, PermissionsAndroid, Platform } from "react-native"
import { useShown } from "@/prototype/extras"
import { screenTimeAvailable } from "@/prototype/screen-time"
import { drainSurfaceActions } from "./actions"
import { buildAllLive, liveKey } from "./live-state"
import {
  clearSurfaces,
  onQueuedAction,
  surfacesAvailable,
  writeLive,
  writeSnapshot,
} from "./native"
import { buildSnapshot, snapshotKey } from "./snapshot"

// Keeps the home-screen widgets and the lock-screen activity in step with
// the app's stores, and applies taps made on them (ADR-0020). Mounted once,
// inside the signed-in app.

const WRITE_DEBOUNCE_MS = 600

function useMinute() {
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000))
  useEffect(() => {
    const id = setInterval(
      () => setMinute(Math.floor(Date.now() / 60_000)),
      60_000,
    )
    return () => clearInterval(id)
  }, [])
  return minute
}

async function askNotifications() {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return
  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
  if (await PermissionsAndroid.check(perm)) return
  await PermissionsAndroid.request(perm)
}

export function SurfacesBridge() {
  if (!surfacesAvailable) return null
  return <Bridge />
}

function Bridge() {
  const habits = habitsStore.use((s) => s)
  const tasks = tasksStore.use((s) => s)
  const fit = fitStore.use((s) => s)
  const fin = finStore.use((s) => s)
  const targetThreshold = dashStore.use((s) => s.targetThreshold)
  const enabled = dashStore.use((s) => s.enabled)
  const live = liveStore.use((s) => s.live)
  const focus = focusStore.use((s) => s)
  const run = runLiveStore.use((s) => s.active)
  const privacy = privacyStore.use((s) => s.hidden)
  const ring = D.useTodayRing()
  const lifeScore = D.useLifeScore(7).score
  const streak = D.useOnTarget(7).current
  const journal = useShown("journal")
  const minute = useMinute()
  const day = dayKey(new Date(minute * 60_000))

  const lastSnapshot = useRef("")
  const lastLive = useRef<string | null>(null)

  // Taps made while the app was closed, then any made while it runs. Back
  // in the foreground the activity is written again even when nothing
  // changed: the person may have swiped it away, the system may have ended
  // it, or Live Activities were just turned on in Settings.
  useEffect(() => {
    drainSurfaceActions()
    const off = onQueuedAction(() => drainSurfaceActions())
    const app = AppState.addEventListener("change", (s) => {
      if (s !== "active") return
      drainSurfaceActions()
      const state = buildAllLive({
        live: liveStore.get().live,
        habits: habitsStore.get(),
        fit: fitStore.get(),
        focus: focusStore.get(),
        run: runLiveStore.get().active,
      })
      if (!state) return
      lastLive.current = liveKey(state)
      writeLive(state)
    })
    return () => {
      off()
      app.remove()
    }
  }, [])
  // The signed-in layout unmounts on sign-out. The refs reset too, so a
  // remount (or React's dev double-run) writes everything again.
  useEffect(
    () => () => {
      lastSnapshot.current = ""
      lastLive.current = null
      clearSurfaces()
    },
    [],
  )
  // ``day`` re-runs this at midnight so the widgets move to the new day.
  // biome-ignore lint/correctness/useExhaustiveDependencies: day is the clock tick
  useEffect(() => {
    const snapshot = buildSnapshot({
      habits,
      tasks,
      fit,
      fin,
      dash: { targetThreshold, enabled },
      live,
      privacy,
      ring: { done: ring.done, due: ring.due },
      lifeScore,
      streak,
      journal,
      screenTime: screenTimeAvailable(),
    })
    const key = snapshotKey(snapshot)
    if (key === lastSnapshot.current) return
    const id = setTimeout(() => {
      lastSnapshot.current = key
      writeSnapshot(snapshot)
    }, WRITE_DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [
    habits,
    tasks,
    fit,
    fin,
    targetThreshold,
    enabled,
    live,
    privacy,
    ring.done,
    ring.due,
    lifeScore,
    streak,
    journal,
    day,
  ])

  useEffect(() => {
    const state = buildAllLive({ live, habits, fit, focus, run })
    const key = liveKey(state)
    if (key === lastLive.current) return
    if (state && !lastLive.current) void askNotifications()
    lastLive.current = key
    writeLive(state)
  }, [live, habits, fit, focus, run])

  return null
}
