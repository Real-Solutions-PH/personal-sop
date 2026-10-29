// Screen time on the foreground (spec 2026-10-29-screen-time-design, "When
// logs are written"): read what the monitor extension stored, turn it into
// screen_day rows and auto-habit logs, and keep the daily schedule in step
// with the groups and rules. Everything resolves: a missing native module,
// denied permission or a failing call leaves the stores as they were.

import type { Habit } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { DAY_START_HOUR } from "@domain/lib/day"
import { newId } from "@domain/lib/ids"
import { applyReconcile } from "@domain/screen/actions"
import type { ScreenGroup } from "@domain/screen/data"
import { reconcile, rungsFor } from "@domain/screen/logic"
import { screenStore } from "@domain/screen/store"
import { useEffect } from "react"
import { AppState } from "react-native"
import { create } from "zustand"
import { syncReady } from "@/live/ready"
import * as ST from "./screen-time"

/** The last plan handed to startMonitoring, as JSON. */
export const PLAN_KEY = "screen.plan"
type Storage =
  typeof import("@react-native-async-storage/async-storage").default
/** Loaded on first use: a build without the native module throws on import,
 * and then the plan is simply sent each time. */
function storage(): Storage | null {
  try {
    const m = require("@react-native-async-storage/async-storage") as
      | Storage
      | { default: Storage }
    return "default" in m ? m.default : m
  } catch {
    return null
  }
}
/** The phone's day start; the profile's own hour is not on the device yet. */
const dayStartHour = () => DAY_START_HOUR

/** What the settings screen shows: permission, and which groups have apps
 * picked on this phone (the picks never leave it). `null` = not asked yet. */
export const screenStatus = create<{
  auth: ST.ScreenAuth | null
  picked: Record<string, boolean>
}>(() => ({ auth: null, picked: {} }))

const live = (h: Habit) => h.status !== "archived" && !h.archivedAt
const liveGroups = (groups: ScreenGroup[]) =>
  groups.filter((g) => !g.archivedAt).sort((a, b) => a.id.localeCompare(b.id))

/** Ask the phone for the permission and each group's picks. */
export async function refreshScreenStatus(): Promise<void> {
  try {
    if (!ST.screenTimeAvailable()) {
      screenStatus.setState({ auth: "unavailable", picked: {} })
      return
    }
    const auth = await ST.authorizationStatus()
    const picked: Record<string, boolean> = {}
    if (auth === "approved")
      for (const g of liveGroups(screenStore.get().groups))
        if (g.kind === "custom") picked[g.id] = await ST.hasSelection(g.id)
    screenStatus.setState({ auth, picked })
  } catch {
    // Leave the last answer showing.
  }
}

/** Whether Screen time needs nothing more on this phone: it is connected
 * (or a group has apps picked), or the phone can't read Screen Time at all,
 * so there is nothing to set up here. */
export function useScreenSetUp(): boolean {
  const s = screenStatus()
  useEffect(() => {
    void refreshScreenStatus()
  }, [])
  return (
    !ST.screenTimeAvailable() ||
    s.auth === "approved" ||
    Object.values(s.picked).some(Boolean)
  )
}

/** Every live group the phone can count (All apps, or a custom group with
 * apps picked here), each with its rungs: the standard ladder plus one past
 * every live rule's limit on it. */
export function monitoringPlan(
  groups: ScreenGroup[],
  habits: Habit[],
  picked: Record<string, boolean>,
): ST.ScreenPlan[] {
  return liveGroups(groups)
    .filter((g) => g.kind === "all" || picked[g.id])
    .map((g) => ({
      groupId: g.id,
      kind: g.kind,
      rungs: rungsFor(
        habits
          .filter((h) => live(h) && h.rule?.groupId === g.id)
          .map((h) => h.rule?.maxMin ?? 0),
      ),
    }))
}

async function run(): Promise<void> {
  if (!ST.screenTimeAvailable()) return
  await refreshScreenStatus()
  const { auth, picked } = screenStatus.getState()
  if (auth !== "approved") return
  const events = await ST.readEvents()
  const h = habitsStore.get()
  applyReconcile(
    reconcile({
      events,
      habits: h.habits,
      logs: h.logs,
      existingDays: screenStore.get().days,
      nowMs: Date.now(),
      dayStartHour: dayStartHour(),
      newId,
    }),
  )
  const plan = monitoringPlan(
    screenStore.get().groups,
    habitsStore.get().habits,
    picked,
  )
  const hash = JSON.stringify({ plan, dayStartHour: dayStartHour() })
  const store = storage()
  if (store && (await store.getItem(PLAN_KEY)) === hash) return
  await ST.startMonitoring(plan, dayStartHour())
  await store?.setItem(PLAN_KEY, hash)
}

let running: Promise<void> | null = null
let again = false
/** Reconcile and reschedule. A call while one runs makes it run once more
 * (an edit made mid-sync is still picked up). Never rejects. */
export function syncScreenTime(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      try {
        await run()
      } catch {
        // Best effort: the next foreground tries again.
      }
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

/** Call once from the signed-in layout: syncs now and on every return to
 * the foreground, after the first pull so the stores hold the account's
 * logs (a reconcile never writes over a log it can see). */
export function startScreenSync(): () => void {
  const kick = () => {
    if (syncReady.getState().ready) void syncScreenTime()
  }
  const app = AppState.addEventListener("change", (s) => {
    if (s === "active") kick()
  })
  const ready = syncReady.subscribe(kick)
  kick()
  return () => {
    app.remove()
    ready()
  }
}
