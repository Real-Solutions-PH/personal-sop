// The focus timer outside its screen (ADR-0025): the Live bar, the
// notification when a set or break ends, and writing down transitions that
// came due while the phone was locked. Everything reads the focus store,
// so a session started by Fern or on another device shows here too.

import { current, liveTimeline, tickFocus } from "@domain/focus/actions"
import type { FocusState } from "@domain/focus/data"
import * as L from "@domain/focus/logic"
import { focusStore } from "@domain/focus/store"
import { type Live, liveStore } from "@domain/lib/live"
import { AppState, Platform } from "react-native"

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
  const onChange = () => {
    syncLiveBar()
    if (N) void scheduleNotice(N).catch(() => {})
  }
  focusStore.subscribe(onChange)
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      tickFocus()
      onChange()
    }
  })
  // A set that ended while the app was closed is written down at launch.
  tickFocus()
  onChange()
}
