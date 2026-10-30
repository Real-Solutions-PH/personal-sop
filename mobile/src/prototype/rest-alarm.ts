// The workout rest timer's alarm: a notification with sound when rest
// ends, so a locked phone rings for the next set. Rescheduled whenever the
// timer moves (−15/+15, from the app or the lock screen), cancelled when it
// is skipped or the workout ends. With the app open it chimes itself: the
// banner's sound is off then, and no notification permission is needed.

import type { FitnessState } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import * as Haptics from "expo-haptics"
import { AppState, Platform } from "react-native"
import { chime } from "./chime"

type Notifications = typeof import("expo-notifications")

export const REST_NOTICE_ID = "workout-rest"
const WORKOUT_HREF = "/fitness/workout"

/** When rest ends and what to say; null when no rest is counting down. */
export function restNotice(s: FitnessState, now = Date.now()) {
  if (!s.rest) return null
  const at = new Date(s.rest.endsAt)
  if (at.getTime() <= now) return null
  const w = s.workouts.find(
    (x) => x.id === s.activeId && x.status === "in_progress",
  )
  return {
    at,
    title: "Rest over",
    body: w ? `${w.name} · time for the next set.` : "Time for the next set.",
  }
}

let started = false
let last = ""
let asked = false
let ring: ReturnType<typeof setTimeout> | null = null

/** Chime at ``at`` if the app is on screen then. A timer that fires late
 * (the app was suspended) stays quiet: the notification already rang. */
function ringAt(at: Date | null) {
  if (ring) clearTimeout(ring)
  ring = null
  if (!at) return
  ring = setTimeout(
    () => {
      if (AppState.currentState !== "active") return
      if (Date.now() - at.getTime() > 3000) return
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {})
      chime()
    },
    Math.max(0, at.getTime() - Date.now()),
  )
}

async function schedule(N: Notifications) {
  const notice = restNotice(fitStore.get())
  const key = notice ? String(notice.at.getTime()) : ""
  if (key === last) return
  last = key
  ringAt(notice?.at ?? null)
  await N.cancelScheduledNotificationAsync(REST_NOTICE_ID).catch(() => {})
  if (!notice) return
  let perm = await N.getPermissionsAsync()
  // The first rest is when the alarm is first needed: ask then, once.
  if (perm.status === "undetermined" && !asked) {
    asked = true
    perm = await N.requestPermissionsAsync()
  }
  if (perm.status !== "granted" || key !== last) return
  await N.scheduleNotificationAsync({
    identifier: REST_NOTICE_ID,
    content: {
      title: notice.title,
      body: notice.body,
      sound: "default",
      data: { href: WORKOUT_HREF },
    },
    trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: notice.at },
  })
}

/** Call once after sign-in (the signed-in layout does). */
export function startRestAlarm() {
  if (started || Platform.OS === "web") return
  started = true
  let N: Notifications
  try {
    N = require("expo-notifications") as Notifications
  } catch {
    return // the native module is missing from this build
  }
  // A failed schedule is retried on the next change, not skipped as done.
  const onChange = () =>
    void schedule(N).catch(() => {
      last = ""
    })
  fitStore.subscribe(onChange)
  onChange()
}
