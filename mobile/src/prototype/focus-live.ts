// The focus timer outside its screen (ADR-0025): the Live bar, the
// notification when a set or break ends, and writing down transitions that
// came due while the phone was locked. Everything reads the focus store,
// so a session started by Fern or on another device shows here too.

import { current, liveTimeline, tickFocus } from "@domain/focus/actions"
import type { FocusState } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { focusStore } from "@domain/focus/store"
import { type Live, liveStore } from "@domain/lib/live"
import * as Haptics from "expo-haptics"
import { AppState, Platform } from "react-native"
import { chime } from "./chime"

type Notifications = typeof import("expo-notifications")

export const FOCUS_HREF = "/focus"
export const PHASE_NOTICE_ID = "focus-phase"

/** The Live bar entry the running session stands for (null: none). */
export function focusLive(s: FocusState, now = Date.now()): Live | null {
  const cur = current(s)
  const tl = liveTimeline(s, now)
  if (!cur || !tl) return null
  const p = L.phase(tl, now)
  const what = p.item?.title ?? (p.kind === "break" ? "Break" : "Focus")
  return {
    kind: "focus",
    label: `Focus · ${what}`,
    href: FOCUS_HREF,
    startedAt: cur.startedAt,
    ...(p.status === "paused" || p.status === "waiting"
      ? { pausedAt: new Date(now).toISOString() }
      : {}),
  }
}

/** What to tell the person when the phase running now ends; null when
 * nothing will end by itself (paused, waiting, a stopwatch). */
export function phaseNotice(s: FocusState, now = Date.now()) {
  if (!s.settings.notify) return null
  const tl = liveTimeline(s, now)
  if (!tl) return null
  const p = L.phase(tl, now)
  if (p.status !== "running" || p.endsAt === null) return null
  const set = p.setIndex + 1
  if (p.kind === "focus")
    return {
      at: new Date(p.endsAt),
      title: `Set ${set} done`,
      body: tl.sess.autoStartBreaks
        ? `${L.fmtHm(L.breakSec(tl.sess, p.setIndex))} break starts now.`
        : "Time for a break. Tap to start it.",
    }
  return {
    at: new Date(p.endsAt),
    title: p.longBreak ? "Long break over" : "Break over",
    body:
      tl.sess.autoStartFocus && !p.longBreak
        ? `Set ${set + 1} starts now.`
        : `Tap to start set ${set + 1}.`,
  }
}

/** Sets that ran their full length, as ``session:set`` keys: the set's
 * closed focus time reached what it was planned for (a second's slack). A
 * set skipped or ended early is not in it. Sessions started within the last
 * day only. */
export function finishedSets(s: FocusState, now = Date.now()): Set<string> {
  const since = now - 86_400_000
  const recent = new Set(
    s.sessions
      .filter((x) => new Date(x.startedAt).getTime() >= since)
      .map((x) => x.id),
  )
  const sets = new Map<string, { sec: number; planned: number }>()
  for (const g of s.segments) {
    if (g.kind !== "focus" || !recent.has(g.sessionId) || !g.endedAt) continue
    const key = `${g.sessionId}:${g.setIndex}`
    const x = sets.get(key) ?? { sec: 0, planned: 0 }
    x.sec +=
      (new Date(g.endedAt).getTime() - new Date(g.startedAt).getTime()) / 1000
    x.planned = Math.max(x.planned, g.plannedSec ?? 0)
    sets.set(key, x)
  }
  const out = new Set<string>()
  for (const [k, x] of sets)
    if (x.planned > 0 && x.sec >= x.planned - 1) out.add(k)
  return out
}

/** Keys in ``now`` that ``before`` did not have. */
export const newlyFinished = (before: Set<string>, now: Set<string>) =>
  [...now].filter((k) => !before.has(k))

const sameLive = (a: Live | null, b: Live | null) =>
  a?.kind === b?.kind &&
  a?.label === b?.label &&
  a?.href === b?.href &&
  !!a?.pausedAt === !!b?.pausedAt

/** Keep the Live bar on the running session, unless a routine, workout or
 * habit timer holds it. */
export function syncLiveBar(now = Date.now()) {
  const held = liveStore.get().live
  if (held && held.kind !== "focus") return
  const next = focusLive(focusStore.get(), now)
  if (sameLive(held, next)) return
  liveStore.set({ live: next })
}

let started = false
let lastNotice = ""

async function scheduleNotice(N: Notifications) {
  const notice = phaseNotice(focusStore.get())
  const key = notice ? `${notice.at.getTime()}|${notice.title}` : ""
  if (key === lastNotice) return
  lastNotice = key
  await N.cancelScheduledNotificationAsync(PHASE_NOTICE_ID).catch(() => {})
  if (!notice || notice.at.getTime() <= Date.now()) return
  const perm = await N.getPermissionsAsync()
  if (perm.status !== "granted") return
  await N.scheduleNotificationAsync({
    identifier: PHASE_NOTICE_ID,
    content: {
      title: notice.title,
      body: notice.body,
      data: { href: FOCUS_HREF },
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DATE,
      date: notice.at,
    },
  })
}

/** Call once after sign-in (the signed-in layout does). */
export function startFocusLive() {
  if (started) return
  started = true
  let N: Notifications | null = null
  if (Platform.OS !== "web")
    try {
      N = require("expo-notifications") as Notifications
    } catch {
      N = null // the native module is missing from this build
    }
  // Sets already finished when the app starts are history, not news, and
  // so are the ones written down on coming back (the notification told).
  let finished = finishedSets(focusStore.get())
  let away = false
  let wake: ReturnType<typeof setTimeout> | null = null
  const onChange = () => {
    // A set that runs out while the app is open answers with a success tap
    // and a chime.
    const next = finishedSets(focusStore.get())
    if (
      !away &&
      newlyFinished(finished, next).length &&
      AppState.currentState === "active"
    ) {
      // expo-haptics, not motion's feel: this module loads outside any screen
      // (the widgets' bridge), where Reanimated must not be pulled in.
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {})
      chime()
    }
    finished = next
    syncLiveBar()
    if (N) void scheduleNotice(N).catch(() => {})
    // Nothing else ticks the timer off its own screen: write the phase
    // down as it ends, so the chime comes on time wherever the app is.
    if (wake) clearTimeout(wake)
    const end = phaseNotice({
      ...focusStore.get(),
      settings: { ...focusStore.get().settings, notify: true },
    })?.at.getTime()
    if (end) wake = setTimeout(() => tickFocus(), end - Date.now() + 300)
  }
  const quietly = () => {
    away = true
    tickFocus()
    away = false
    onChange()
  }
  focusStore.subscribe(onChange)
  AppState.addEventListener("change", (state) => {
    if (state === "active") quietly()
  })
  // A set that ended while the app was closed is written down at launch.
  quietly()
}
