// The workout rest timer's alarm: a notification with sound when rest
// ends, so a locked phone rings for the next set. Rescheduled whenever the
// timer moves (−15/+15, from the app or the lock screen), cancelled when it
// is skipped or the workout ends.

import type { FitnessState } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { Platform } from "react-native"

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

async function schedule(N: Notifications) {
  const notice = restNotice(fitStore.get())
  const key = notice ? String(notice.at.getTime()) : ""
  if (key === last) return
  last = key
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
  const onChange = () => void schedule(N).catch(() => {})
  fitStore.subscribe(onChange)
  onChange()
}
