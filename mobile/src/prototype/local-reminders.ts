// Reminders as notifications scheduled on the phone itself: a task's
// reminder time, and each habit that has reminders on, at its scheduled
// time on its days. Local notifications need no push service or paid
// Apple account, and fire offline. The plan is rebuilt whenever tasks or
// habits change; iOS keeps at most 64 pending, so the soonest win.

import { fitStore } from "@domain/fitness/store"
import type { Habit, Routine } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { Platform } from "react-native"
import { go } from "./navigation"

type Notifications = typeof import("expo-notifications")

export type Planned =
  | {
      id: string
      title: string
      body: string
      href: string
      at: Date
    }
  | {
      id: string
      title: string
      body: string
      href: string
      /** iOS/Expo weekday: 1 = Sunday … 7 = Saturday. */
      weekly: { weekday: number; hour: number; minute: number }
    }
  | {
      id: string
      title: string
      body: string
      href: string
      daily: { hour: number; minute: number }
    }

/** Reminders beyond tasks and habits: routines with reminders on, and the
 * daily weigh-in time from Fitness settings (empty = off). */
export interface MoreReminders {
  routines?: readonly Routine[]
  weighIn?: string | null
}

/** iOS allows 64 pending notifications; leave room for the system's own. */
export const MAX_PENDING = 60
const OURS = /^(task|habit|routine|weigh-in)/
const HORIZON_DAYS = 30

const hm = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return Number.isFinite(h) && Number.isFinite(m)
    ? { hour: h, minute: m }
    : null
}

/** What to schedule, soonest first, capped at ``MAX_PENDING``. Pure. */
export function planReminders(
  tasks: readonly Task[],
  habits: readonly Habit[],
  now: Date,
  more: MoreReminders = {},
): Planned[] {
  const habitPlans: Planned[] = []
  const weighIn = more.weighIn ? hm(more.weighIn) : null
  if (weighIn)
    habitPlans.push({
      id: "weigh-in",
      title: "⚖️ Weigh-in",
      body: "Before water or training. Tap to log it.",
      href: "/fitness/body",
      daily: weighIn,
    })
  for (const r of more.routines ?? []) {
    if (!r.reminder || r.status !== "active" || !r.steps.length) continue
    for (const slot of r.schedule) {
      const time = slot.time ? hm(slot.time) : null
      if (!time) continue
      for (const day of slot.days)
        habitPlans.push({
          id: `routine-${r.id}-${day}-${slot.time}`,
          title: `${r.icon} ${r.name}`,
          body: `${r.steps.length} steps. Tap to start.`,
          href: `/habits/routines/${r.id}`,
          weekly: { weekday: day + 1, ...time },
        })
    }
  }
  for (const h of habits) {
    if (!h.reminder || h.status !== "active") continue
    for (const slot of h.schedule) {
      const time = slot.time ? hm(slot.time) : null
      if (!time) continue
      for (const day of slot.days)
        habitPlans.push({
          id: `habit-${h.id}-${day}-${slot.time}`,
          title: `${h.icon} ${h.name}`,
          body: "Time for this one. Tap to check it off.",
          href: `/habits/${h.id}`,
          weekly: { weekday: day + 1, ...time },
        })
    }
  }
  const end = now.getTime() + HORIZON_DAYS * 86_400_000
  const taskPlans: Planned[] = tasks
    .filter((t) => t.status === "open" && t.remindAt)
    .map((t) => ({ t, at: new Date(t.remindAt as string) }))
    .filter(({ at }) => at.getTime() > now.getTime() && at.getTime() <= end)
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ t, at }) => ({
      id: `task-${t.id}`,
      title: t.title,
      body: t.dueTime ? `Due at ${t.dueTime}` : "Due today",
      href: `/tasks/task/${t.id}`,
      at,
    }))
  // Recurring habit reminders first (few, and they repeat), then the
  // soonest task reminders in the room left.
  const habitsKept = habitPlans.slice(0, MAX_PENDING)
  return [...habitsKept, ...taskPlans.slice(0, MAX_PENDING - habitsKept.length)]
}

const load = () => require("expo-notifications") as Notifications

/** Replace this app's scheduled reminders with the current plan. Never
 * asks for permission (Settings does that); without it, does nothing. */
export async function syncReminders(
  N: Notifications = load(),
  now: Date = new Date(),
): Promise<number> {
  if (Platform.OS === "web") return 0
  const perm = await N.getPermissionsAsync()
  if (perm.status !== "granted") return 0
  const pending = await N.getAllScheduledNotificationsAsync()
  await Promise.all(
    pending
      .filter((p) => OURS.test(p.identifier))
      .map((p) => N.cancelScheduledNotificationAsync(p.identifier)),
  )
  const plan = planReminders(
    tasksStore.get().tasks,
    habitsStore.get().habits,
    now,
    {
      routines: habitsStore.get().routines,
      weighIn: fitStore.get().settings.weighInReminder,
    },
  )
  for (const p of plan)
    await N.scheduleNotificationAsync({
      identifier: p.id,
      content: { title: p.title, body: p.body, data: { href: p.href } },
      trigger:
        "at" in p
          ? { type: N.SchedulableTriggerInputTypes.DATE, date: p.at }
          : "daily" in p
            ? { type: N.SchedulableTriggerInputTypes.DAILY, ...p.daily }
            : {
                type: N.SchedulableTriggerInputTypes.WEEKLY,
                ...p.weekly,
              },
    })
  return plan.length
}

/** A real notification a few seconds from now, to see reminders work. */
export async function sendTestReminder(N: Notifications = load()) {
  if (Platform.OS === "web") return false
  const perm = await N.getPermissionsAsync()
  if (perm.status !== "granted") return false
  await N.scheduleNotificationAsync({
    identifier: "test-reminder",
    content: {
      title: "Reminders work",
      body: "This is what a reminder looks like.",
      data: { href: "/tasks" },
    },
    trigger: { type: N.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 3 },
  })
  return true
}

let started = false
/** Keep reminders in step with tasks and habits; open what a tapped
 * reminder points to. Call once, after sign-in. */
export function startReminders() {
  if (started || Platform.OS === "web") return
  started = true
  let N: Notifications
  try {
    N = load()
  } catch {
    return // the native module is missing from this build
  }
  // Show reminders as banners even while the app is open.
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
  N.addNotificationResponseReceivedListener((r) => {
    const href = r.notification.request.content.data?.href
    if (typeof href === "string") go(href)
  })
  let timer: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void syncReminders(N).catch(() => {}), 1500)
  }
  tasksStore.subscribe(soon)
  habitsStore.subscribe(soon)
  fitStore.subscribe(soon)
  soon()
}
