// Screen time on the foreground (spec 2026-10-29-screen-time-design, "When
// logs are written"): read what the monitor extension stored, turn it into
// screen_day rows and auto-habit logs, and keep the daily schedule in step
// with the groups and rules. Everything resolves: a missing native module,
// denied permission or a failing call leaves the stores as they were.

import { dashStore, setEnabled } from "@domain/dash/store"
import type { Habit } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { DAY_START_HOUR, dayKey } from "@domain/lib/day"
import { newId } from "@domain/lib/ids"
import { applyReconcile } from "@domain/screen/actions"
import type { ScreenGroup } from "@domain/screen/data"
import { dayOf, reconcile, rungsFor } from "@domain/screen/logic"
import { screenStore } from "@domain/screen/store"
import { useEffect } from "react"
import { AppState } from "react-native"
import { toast } from "sonner-native"
import { create } from "zustand"
import { syncReady } from "@/live/ready"
import * as ST from "./screen-time"

/** The last plan handed to startMonitoring, as JSON. */
export const PLAN_KEY = "screen.plan"
/** When this phone first answered "approved", as epoch ms: the 14-day
 * no-data check counts from here, so a fresh connection is not switched
 * off before its first day of minutes arrives. */
export const APPROVED_KEY = "screen.approvedAt"
/** Screen time stays on while a screen day row this recent exists. */
export const DATA_WINDOW_DAYS = 14
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

export const SCREEN_DENIED =
  "Screen Time access is off for Unfurl. Turn it on in Settings › Screen Time to track it."
export const SCREEN_UNAVAILABLE =
  "This phone can't share Screen Time with Unfurl."
const SCREEN_REVOKED =
  "Screen Time access was turned off, so screen time is hidden from your stats."

/** Switches Screen time on, asking iOS first: it turns on only when the
 * permission is approved; otherwise it stays off and says why. */
export async function enableScreenTime(): Promise<boolean> {
  const auth = ST.screenTimeAvailable()
    ? await ST.requestScreenTime()
    : "unavailable"
  await refreshScreenStatus()
  if (auth !== "approved") {
    setEnabled("screen", false)
    toast(auth === "denied" ? SCREEN_DENIED : SCREEN_UNAVAILABLE)
    return false
  }
  await storage()?.setItem(APPROVED_KEY, String(Date.now()))
  setEnabled("screen", true)
  void syncScreenTime()
  return true
}

/** Whether a screen day row exists within the last DATA_WINDOW_DAYS app
 * days. */
function recentData(nowMs: number): boolean {
  const today = new Date(`${dayOf(nowMs, dayStartHour())}T12:00:00`)
  today.setDate(today.getDate() - (DATA_WINDOW_DAYS - 1))
  const from = dayKey(today)
  return screenStore.get().days.some((d) => d.day >= from)
}

/** Keeps the switch in step with the permission once the account's state
 * is known: an explicit deny turns it off (with one toast, since the next
 * run sees it off); a phone that can't read Screen Time, or one approved
 * for 14 days, with no minutes in 14 days turns it off silently. An
 * undetermined permission never turns it off. True = still on. */
async function keepOn(auth: ST.ScreenAuth | null): Promise<boolean> {
  if (!syncReady.getState().ready || auth === null) return true
  if (auth === "notDetermined") return true
  if (auth === "denied") {
    setEnabled("screen", false)
    toast(SCREEN_REVOKED)
    return false
  }
  const nowMs = Date.now()
  if (recentData(nowMs)) return true
  if (auth === "approved") {
    const store = storage()
    const since = Number(await store?.getItem(APPROVED_KEY))
    if (!since) {
      await store?.setItem(APPROVED_KEY, String(nowMs))
      return true
    }
    if (nowMs - since < DATA_WINDOW_DAYS * 86_400_000) return true
  }
  setEnabled("screen", false)
  return false
}

/** Screen time is off: stop the daily schedule once and forget its plan,
 * so turning it back on schedules again. */
async function stopIfMonitoring(): Promise<void> {
  const store = storage()
  if (store && (await store.getItem(PLAN_KEY)) === null) return
  await ST.stopMonitoring()
  await store?.removeItem(PLAN_KEY)
}

async function run(): Promise<void> {
  if (!dashStore.get().enabled.screen) return stopIfMonitoring()
  if (!ST.screenTimeAvailable()) {
    screenStatus.setState({ auth: "unavailable", picked: {} })
    if (!(await keepOn("unavailable"))) await stopIfMonitoring()
    return
  }
  await refreshScreenStatus()
  const { auth, picked } = screenStatus.getState()
  if (auth !== "approved") {
    if (!(await keepOn(auth))) await stopIfMonitoring()
    return
  }
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
  if (!(await keepOn(auth))) return stopIfMonitoring()
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
  // Switching Screen time on or off starts or stops the schedule.
  let on = dashStore.get().enabled.screen
  const sw = dashStore.subscribe(() => {
    const next = dashStore.get().enabled.screen
    if (next === on) return
    on = next
    kick()
  })
  kick()
  return () => {
    app.remove()
    ready()
    sw()
  }
}
