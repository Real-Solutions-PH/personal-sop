// Screen Time on iOS: Family Controls permission, the system app picker, and
// a daily DeviceActivity schedule whose threshold callbacks the
// activity-monitor extension stores in the App Group. Every call resolves
// (never rejects): with no native module (Android, web, a build prebuilt
// without UNFURL_SCREEN_TIME=1) the answers are "unavailable", false and [],
// and the screens show Screen Time as a locked preview.
import type { NativeEvent, ScreenGroupKind } from "@domain/screen/data"
import Constants from "expo-constants"
import { screenTimeModule } from "../../modules/unfurl-screen-time"

export type ScreenAuth = "approved" | "denied" | "notDetermined" | "unavailable"
export interface ScreenPlan {
  groupId: string
  kind: ScreenGroupKind
  rungs: number[]
}

// Expo Go has no Family Controls (Apple grants it per app), so there the
// flow runs on sample data, like Apple Health: permission is granted on
// asking, every pick "saves", and readEvents makes up yesterday's and
// today's usage for the monitored groups.
const expoGo = () => Constants.executionEnvironment === "storeClient"
const sample = {
  auth: "notDetermined" as ScreenAuth,
  picked: new Set<string>(),
  plan: [] as ScreenPlan[],
  dayStartHour: 4,
}

const AUTH: readonly ScreenAuth[] = ["approved", "denied", "notDetermined"]
const asAuth = (s: unknown): ScreenAuth =>
  AUTH.includes(s as ScreenAuth) ? (s as ScreenAuth) : "unavailable"

/** Runs `call` on the native module, or answers `fallback` without one or
 * when it fails. */
async function withNative<T>(
  fallback: T,
  call: (m: NonNullable<ReturnType<typeof screenTimeModule>>) => Promise<T>,
): Promise<T> {
  const m = screenTimeModule()
  if (!m) return fallback
  try {
    return await call(m)
  } catch {
    return fallback
  }
}

export function screenTimeAvailable(): boolean {
  return expoGo() || !!screenTimeModule()
}

export async function authorizationStatus(): Promise<ScreenAuth> {
  if (expoGo()) return sample.auth
  return withNative<ScreenAuth>("unavailable", async (m) =>
    asAuth(await m.authorizationStatus()),
  )
}

export async function requestScreenTime(): Promise<ScreenAuth> {
  if (expoGo()) {
    sample.auth = "approved"
    return sample.auth
  }
  return withNative<ScreenAuth>("unavailable", async (m) =>
    asAuth(await m.requestAuthorization()),
  )
}

/** Opens the system app picker for the group; true if a non-empty
 * selection was saved. */
export async function pickApps(groupId: string): Promise<boolean> {
  if (expoGo()) {
    sample.picked.add(groupId)
    return true
  }
  return withNative(false, async (m) => (await m.pickApps(groupId)) === true)
}

export async function hasSelection(groupId: string): Promise<boolean> {
  if (expoGo()) return sample.picked.has(groupId)
  return withNative(
    false,
    async (m) => (await m.hasSelection(groupId)) === true,
  )
}

/** Replaces the monitored groups: one window a day from `dayStartHour`, an
 * event per rung (minutes). */
export async function startMonitoring(
  plan: ScreenPlan[],
  dayStartHour: number,
): Promise<void> {
  if (expoGo()) {
    sample.plan = plan.map((p) => ({ ...p, rungs: [...p.rungs] }))
    sample.dayStartHour = dayStartHour
    return
  }
  await withNative(undefined, (m) => m.startMonitoring(plan, dayStartHour))
}

export async function stopMonitoring(): Promise<void> {
  if (expoGo()) {
    sample.plan = []
    return
  }
  await withNative(undefined, (m) => m.stopMonitoring())
}

/** What the monitor extension stored, oldest first; lines that aren't a
 * well-formed event are dropped. */
export async function readEvents(): Promise<NativeEvent[]> {
  if (expoGo()) return sampleEvents(Date.now())
  const lines = await withNative<string[]>([], (m) => m.readEvents())
  const out: NativeEvent[] = []
  for (const line of Array.isArray(lines) ? lines : []) {
    const e = parseEvent(line)
    if (e) out.push(e)
  }
  return out
}

function parseEvent(line: unknown): NativeEvent | null {
  if (typeof line !== "string") return null
  let v: unknown
  try {
    v = JSON.parse(line)
  } catch {
    return null
  }
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  const { groupId, at } = o
  if (typeof groupId !== "string" || !Number.isFinite(at)) return null
  const base = { groupId, at: at as number }
  switch (o.kind) {
    case "start":
      return typeof o.hasSelection === "boolean"
        ? { kind: "start", ...base, hasSelection: o.hasSelection }
        : null
    case "end":
      return { kind: "end", ...base }
    case "rung":
      return Number.isFinite(o.rungMin)
        ? { kind: "rung", ...base, rungMin: o.rungMin as number }
        : null
    default:
      return null
  }
}

/** Expo Go: yesterday's whole window and today's so far for each monitored
 * group, crossing the plan's rungs up to a made-up, plausible usage. */
function sampleEvents(nowMs: number): NativeEvent[] {
  const now = new Date(nowMs)
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    sample.dayStartHour,
  )
  if (today.getTime() > nowMs) today.setDate(today.getDate() - 1)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const events: NativeEvent[] = []
  sample.plan.forEach((g, i) => {
    const hasSelection = g.kind === "all" || sample.picked.has(g.groupId)
    const windows = [
      {
        start: yesterday.getTime(),
        until: today.getTime() - 60_000,
        used: 20 + 25 * i,
      },
      { start: today.getTime(), until: nowMs, used: 10 + 15 * i },
    ]
    for (const w of windows) {
      events.push({
        kind: "start",
        groupId: g.groupId,
        at: w.start + 1_000,
        hasSelection,
      })
      if (hasSelection)
        for (const rungMin of [...g.rungs].sort((a, b) => a - b)) {
          const at = w.start + rungMin * 60_000 + 30_000
          if (rungMin > w.used || at > w.until) break
          events.push({ kind: "rung", groupId: g.groupId, at, rungMin })
        }
      if (w.until < nowMs)
        events.push({ kind: "end", groupId: g.groupId, at: w.until })
    }
  })
  return events
}
