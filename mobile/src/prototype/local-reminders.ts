// Reminders as notifications scheduled on the phone itself: a task's
// reminder time, and each habit that has reminders on, at its scheduled
// time on its days. What's already done today is not reminded today. Local notifications need no push service or paid
// Apple account, and fire offline. The plan is rebuilt whenever tasks or
// habits change; iOS keeps at most 64 pending, so the soonest win.
// Bills (planned expenses and transfers) get one reminder a day for the
// week before they're due and each day they're overdue, until paid or
// skipped.
// "Keep reminding me" (``nagEveryMin`` on a task or habit) repeats an
// overdue reminder every that many minutes until the day ends, outside
// quiet hours. They are dated one-offs, so a completion (here, or synced
// from the widget or Fern) drops the rest at the next rebuild.

import { addDays, type Occurrence, occurrencesIn } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import type { Habit, HabitLog, Routine } from "@domain/habits/data"
import { isPausedOn } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey, weekday } from "@domain/lib/day"
import { money } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { Platform } from "react-native"
import {
  openNotification,
  routeLaunchNotification,
  showsBanner,
} from "./notifications"
import { REST_NOTICE_ID } from "./rest-alarm"

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
  /** Bill occurrences from ``BILL_OVERDUE_DAYS`` back to ``HORIZON_DAYS``
   * ahead, so a week's reminders are already set if the app isn't opened
   * again before then. */
  bills?: readonly Occurrence[]
  /** HH:MM for bill reminders (Finance settings); empty = off. */
  billReminder?: string | null
  /** Formats a bill's amount; omitted (hide amounts on) leaves it out. */
  billAmount?: (n: number) => string
  /** Quiet hours (Tasks settings), HH:MM; repeats skip them. */
  quiet?: { start: string; end: string }
  /** When a task with a due day but no time or reminder is due. */
  defaultRemindTime?: string
}

/** The sound bundled by the expo-notifications plugin (app.json); the
 * server's pushes name the same file (backend shared/push.py). */
export const SOUND = "unfurl.wav"
/** Android plays a channel's sound, so reminders get their own channel. */
export const CHANNEL = "reminders"
/** Days of habit repeats planned ahead, today included. */
const NAG_DAYS = 3

const mins = (t: string) => {
  const p = hm(t)
  return p ? p.hour * 60 + p.minute : null
}
/** Is ``d``'s wall-clock time inside ``[start, end)``? Windows may wrap
 * midnight (22:00–07:00); start == end is never quiet. Same rule as the
 * server's tasks ``in_quiet_hours``. */
export function inQuiet(d: Date, quiet?: { start: string; end: string }) {
  if (!quiet) return false
  const s = mins(quiet.start),
    e = mins(quiet.end),
    m = d.getHours() * 60 + d.getMinutes()
  if (s === null || e === null || s === e) return false
  return s < e ? m >= s && m < e : m >= s || m < e
}

/** The repeats after ``anchor``: every ``every`` minutes, later than
 * ``now``, before the end of ``anchor``'s day, outside quiet hours. */
export function nagTimes(
  anchor: Date,
  every: number,
  now: Date,
  quiet?: { start: string; end: string },
): Date[] {
  if (!(every >= 15)) return []
  const end = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    anchor.getDate() + 1,
  ).getTime()
  const out: Date[] = []
  for (let k = 1; ; k++) {
    const at = new Date(anchor.getTime() + k * every * 60_000)
    if (at.getTime() >= end) return out
    if (at > now && !inQuiet(at, quiet)) out.push(at)
  }
}

/** A repeat's id part: its local day and minute, stable across rebuilds. */
const stamp = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}`
}
const fmtHm = (d: Date) =>
  d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })

/** iOS allows 64 pending notifications; leave room for the system's own. */
export const MAX_PENDING = 60
const OURS = /^(task|habit|routine|weigh-in|bill)/
const HORIZON_DAYS = 30
/** Days of reminders before a bill, the due day included. */
export const BILL_DAYS = 7
/** Days an unpaid bill keeps being reminded after its due day; the same
 * two weeks Today keeps an overdue bill on screen. */
export const BILL_OVERDUE_DAYS = 14

const billText = (k: number) =>
  k < -1
    ? `Due in ${-k} days`
    : k === -1
      ? "Due tomorrow"
      : k === 0
        ? "Due today"
        : k === 1
          ? "Overdue since yesterday"
          : `Overdue by ${k} days`

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
  const nagPlans: Planned[] = []
  for (const h of habits) {
    if (!h.reminder || h.status !== "active") continue
    const log = more.logs?.find((l) => l.habitId === h.id && l.day === today),
      // Done or skipped; a count habit part-way there still needs the nudge.
      doneToday = !!log && (log.status !== "partial" || h.type === "check")
    if (h.nagEveryMin)
      for (let n = doneToday ? 1 : 0; n < NAG_DAYS; n++) {
        const wd = (weekday(today) + n) % 7
        for (const slot of h.schedule) {
          const time = slot.time ? hm(slot.time) : null
          if (!time || !slot.days.includes(wd)) continue
          const due = onDay(n, time)
          if (isPausedOn(h, dayKey(due))) continue
          for (const at of nagTimes(due, h.nagEveryMin, now, more.quiet))
            nagPlans.push({
              id: `habit-${h.id}-nag-${stamp(at)}`,
              title: `${h.icon} ${h.name}`,
              body: `Still not done. It was due at ${fmtHm(due)}. Tap to check it off.`,
              href: `/habits/${h.id}`,
              at,
            })
        }
      }
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
  for (const t of tasks) {
    if (t.status !== "open" || !t.nagEveryMin) continue
    const due = taskDue(t, more.defaultRemindTime)
    if (!due) continue
    for (const at of nagTimes(due, t.nagEveryMin, now, more.quiet))
      nagPlans.push({
        id: `task-${t.id}-nag-${stamp(at)}`,
        title: t.title,
        body: `Still open. It was due at ${fmtHm(due)}. Tap to finish it.`,
        href: `/tasks/task/${t.id}`,
        at,
      })
  }
  const billPlans: Planned[] = []
  const billTime = more.billReminder ? hm(more.billReminder) : null
  for (const o of more.bills ?? []) {
    if (!billTime || o.item.type === "income") continue
    if (o.status === "paid" || o.status === "skipped") continue
    const amount = more.billAmount ? ` · ${more.billAmount(o.item.amount)}` : ""
    // k: days from the due day, the week before through the overdue days.
    for (let k = 1 - BILL_DAYS; k <= BILL_OVERDUE_DAYS; k++) {
      const [by, bm, bd] = addDays(o.day, k).split("-").map(Number) as [
        number,
        number,
        number,
      ]
      const at = new Date(by, bm - 1, bd, billTime.hour, billTime.minute)
      if (at <= now) continue
      billPlans.push({
        id: `bill-${o.item.id}-${o.orig}-${k}`,
        title: `💳 ${o.item.name}`,
        body: `${billText(k)}${amount}`,
        href: `/finance/planned/${o.item.id}`,
        at,
      })
    }
  }
  const time = (p: Planned) => ("at" in p ? p.at.getTime() : 0)
  // Recurring habit reminders first (few, and they repeat), then the
  // soonest dated bill and task reminders in the room left.
  const habitsKept = habitPlans.slice(0, MAX_PENDING)
  const dated = [...billPlans, ...taskPlans, ...nagPlans].sort(
    (a, b) => time(a) - time(b),
  )
  return [...habitsKept, ...dated.slice(0, MAX_PENDING - habitsKept.length)]
}

/** When a task counts as overdue: its reminder, else its due time, else
 * its due day at the default reminder time. */
function taskDue(t: Task, defaultTime = "09:00"): Date | null {
  if (t.remindAt) return new Date(t.remindAt)
  if (!t.dueDate) return null
  const time = hm(t.dueTime ?? defaultTime)
  if (!time) return null
  const [y, m, d] = t.dueDate.split("-").map(Number) as [number, number, number]
  return new Date(y, m - 1, d, time.hour, time.minute)
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
      bills: occurrencesIn(
        finStore.get(),
        addDays(dayKey(now), -BILL_OVERDUE_DAYS),
        addDays(dayKey(now), HORIZON_DAYS + BILL_DAYS),
      ),
      billReminder: finStore.get().settings.billReminder,
      billAmount: privacyStore.get().hidden ? undefined : (n) => money(n),
      quiet: {
        start: tasksStore.get().settings.quietStart,
        end: tasksStore.get().settings.quietEnd,
      },
      defaultRemindTime: tasksStore.get().settings.defaultRemindTime,
    },
  )
  for (const p of plan)
    await N.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title: p.title,
        body: p.body,
        data: { href: p.href },
        sound: SOUND,
      },
      trigger:
        "at" in p
          ? {
              type: N.SchedulableTriggerInputTypes.DATE,
              date: p.at,
              channelId: CHANNEL,
            }
          : "daily" in p
            ? {
                type: N.SchedulableTriggerInputTypes.DAILY,
                ...p.daily,
                channelId: CHANNEL,
              }
            : {
                type: N.SchedulableTriggerInputTypes.WEEKLY,
                ...p.weekly,
                channelId: CHANNEL,
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
      sound: SOUND,
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: CHANNEL,
    },
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
      sound: SOUND,
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
      channelId: CHANNEL,
    },
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
  // Show reminders and pushes as banners even while the app is open,
  // except Fern's reply to the chat already on screen.
  N.setNotificationHandler({
    handleNotification: async (n) => {
      const show = showsBanner(n.request.content.data)
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        // The rest alarm chimes in-app (rest-alarm.ts): no second sound.
        shouldPlaySound: show && n.request.identifier !== REST_NOTICE_ID,
        shouldSetBadge: false,
      }
    },
  })
  if (Platform.OS === "android")
    void N.setNotificationChannelAsync(CHANNEL, {
      name: "Reminders",
      importance: N.AndroidImportance.HIGH,
      sound: SOUND,
    }).catch(() => {})
  N.addNotificationResponseReceivedListener((r) =>
    openNotification(r.notification.request.content.data),
  )
  routeLaunchNotification(N)
  let timer: ReturnType<typeof setTimeout> | null = null
  const soon = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void syncReminders(N).catch(() => {}), 1500)
  }
  tasksStore.subscribe(soon)
  habitsStore.subscribe(soon)
  fitStore.subscribe(soon)
  finStore.subscribe(soon)
  privacyStore.subscribe(soon)
  soon()
}
