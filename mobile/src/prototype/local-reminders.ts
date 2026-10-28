// Reminders as notifications scheduled on the phone itself: a task's
// reminder time, and each habit that has reminders on, at its scheduled
// time on its days. What's already done today is not reminded today. Local notifications need no push service or paid
// Apple account, and fire offline. The plan is rebuilt whenever tasks or
// habits change; iOS keeps at most 64 pending, so the soonest win.

import { fitStore } from "@domain/fitness/store"
import type { Habit, HabitLog, Routine } from "@domain/habits/data"
import { habitsStore } from "@domain/habits/store"
import { dayKey, weekday } from "@domain/lib/day"
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
 * daily weigh-in time from Fitness settings (empty = off). `logs` and
 * `weighedToday` drop today's reminder for what's already done. */
export interface MoreReminders {
  routines?: readonly Routine[]
  weighIn?: string | null
  logs?: readonly HabitLog[]
  weighedToday?: boolean
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
  // A repeating trigger can't skip one day, so what's done today gets
  // dated one-offs instead; the next sync (any habit change or app open)
  // puts the repeating ones back.
  const today = dayKey(now),
    [y, mo, d] = today.split("-").map(Number) as [number, number, number],
    onDay = (plus: number, t: { hour: number; minute: number }) =>
      new Date(y, mo - 1, d + plus, t.hour, t.minute)
  const weighIn = more.weighIn ? hm(more.weighIn) : null
  const weighInText = {
    title: "⚖️ Weigh-in",
    body: "Before water or training. Tap to log it.",
    href: "/fitness/body",
  }
  if (weighIn && more.weighedToday)
    for (let n = 1; n <= 6; n++)
      habitPlans.push({
        id: `weigh-in-${n}`,
        ...weighInText,
        at: onDay(n, weighIn),
      })
  else if (weighIn)
    habitPlans.push({ id: "weigh-in", ...weighInText, daily: weighIn })
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
    const log = more.logs?.find((l) => l.habitId === h.id && l.day === today),
      // Done or skipped; a count habit part-way there still needs the nudge.
      doneToday = !!log && (log.status !== "partial" || h.type === "check")
    for (const slot of h.schedule) {
      const time = slot.time ? hm(slot.time) : null
      if (!time) continue
      for (const day of slot.days) {
        const text = {
          id: `habit-${h.id}-${day}-${slot.time}`,
          title: `${h.icon} ${h.name}`,
          body: "Time for this one. Tap to check it off.",
          href: `/habits/${h.id}`,
        }
        habitPlans.push(
          doneToday && day === weekday(today)
            ? { ...text, at: onDay(7, time) }
            : { ...text, weekly: { weekday: day + 1, ...time } },
        )
      }
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
      logs: habitsStore.get().logs,
      weighedToday: fitStore
        .get()
        .weighIns.some((w) => dayKey(new Date(w.measuredAt)) === dayKey(now)),
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

/** Tonight's nudge to add the day's burned kcal to the budget: at 20:00, only
 * while what Apple Health counted is more than 100 kcal past what was added.
 * Its id is outside ``OURS``, so rebuilding task and habit reminders keeps it. */
export async function scheduleEatBackReminder(
  burned: number,
  added: number,
  N: Notifications = load(),
  now: Date = new Date(),
) {
  if (Platform.OS === "web") return
  if ((await N.getPermissionsAsync()).status !== "granted") return
  await N.cancelScheduledNotificationAsync("eat-back")
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 20)
  const extra = burned - added
  if (extra <= 100 || now >= at) return
  await N.scheduleNotificationAsync({
    identifier: "eat-back",
    content: {
      title: "🔥 Add today's burn?",
      // No number: more burning by 20:00 would make it wrong.
      body: "Apple Health counted calories you haven't added to today's budget. Tap to add them, or ignore.",
      data: { href: "/nutrition" },
    },
    trigger: { type: N.SchedulableTriggerInputTypes.DATE, date: at },
  })
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
