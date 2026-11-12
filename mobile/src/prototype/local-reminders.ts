// Reminders as notifications scheduled on the phone itself: a task's
// reminder time, and each habit that has reminders on, at its scheduled
// time on its days. What's already done today is not reminded today. Local notifications need no push service or paid
// Apple account, and fire offline. The plan is rebuilt whenever tasks or
// habits change; iOS keeps at most 64 pending, so what fires in the next
// day wins, then the soonest.
// Bills (planned expenses and transfers) get one reminder a day for the
// week before they're due and each day they're overdue, until paid or
// skipped.
// "Keep reminding me" (``nagEveryMin`` on a task or habit) repeats an
// overdue reminder every that many minutes until the day ends, outside
// quiet hours. They are dated one-offs, so a completion (here, or synced
// from the widget or Fern) drops the rest at the next rebuild.
// A module switched off in Settings sends none of its reminders; the
// rebuild that follows the switch cancels them, and turning it back on
// plans them again. The Journal (an extra, not a module) works the same
// way: hidden, its habit and a routine that is only journaling stay quiet.

import type { ModuleKey } from "@domain/contract"
import { dashStore } from "@domain/dash/store"
import { addDays, type Occurrence, occurrencesIn } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import { fitStore } from "@domain/fitness/store"
import type { Habit, HabitLog, Routine } from "@domain/habits/data"
import { isPausedOn } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { DAY_START_HOUR, dayKey, weekday } from "@domain/lib/day"
import { money } from "@domain/lib/money"
import { privacyStore } from "@domain/lib/privacy"
import type { OverrideKind, ScheduleOverride } from "@domain/schedule/data"
import { scheduleStore } from "@domain/schedule/store"
import type { Task } from "@domain/tasks/data"
import { tasksStore } from "@domain/tasks/store"
import { Platform } from "react-native"
import { extrasStore } from "./extras"
import {
  notePushOpen,
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
  /** The module switches (Settings); a module that is off is never
   * reminded. Omitted = all on. */
  enabled?: Partial<Record<ModuleKey, boolean>>
  /** The Journal is shown (Settings, the profile's ``enabled_extras``).
   * Hidden = no reminders for journaling. Omitted = shown. */
  journal?: boolean
  /** The daily Fern check-in: HH:MM (empty = off) and the day one was last
   * sent, which moves today's ask to tomorrow. */
  checkin?: { at: string; lastCheckin: string | null }
  /** Items moved on the Plan tab for one day: that day's reminder fires at
   * the moved time, and the item's other days keep their own time. */
  overrides?: readonly ScheduleOverride[]
}

/** A habit that stands for journaling: the same rule the server uses to
 * tick it when an entry is written (capture ``_tick_journal_habit``). */
export const isJournalHabit = (h: Pick<Habit, "name">) =>
  h.name.toLowerCase().includes("journal")

/** A routine that is only journaling: every step is a journal habit. One
 * with any other step in it still reminds, whatever it is called. */
export function isJournalRoutine(r: Routine, habits: readonly Habit[]) {
  const steps = r.steps.map((s) => habits.find((h) => h.id === s.habitId))
  return steps.length > 0 && steps.every((h) => !!h && isJournalHabit(h))
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
const OURS = /^(task|habit|routine|weigh-in|bill|checkin)/
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

/** A habit reminder's text: the habit's name and the day's target, and for
 * a count habit part-way there today, how far (``value``). Facts only, no
 * loss or streak words (docs/26-retention-algorithms.md §6). */
export function habitBody(h: Habit, value?: number) {
  const unit = h.unit ? ` ${h.unit}` : ""
  if (h.type === "count") {
    const target = h.target ?? 1
    return value !== undefined
      ? `${h.name}: ${value} of ${target}${unit} done. Tap to log the next.`
      : `${h.name}: ${target}${unit} today. Tap to log one.`
  }
  if (h.type === "duration" && h.target)
    return `${h.name}: ${h.target} min today. Tap to start.`
  return `Time for ${h.name}. Tap to check it off.`
}

/** The slot that day's occurrence uses (the calendar's ``slotFor``: the
 * first slot on that weekday); a move replaces it alone. */
const firstSlot = <T extends { days: number[] }>(
  schedule: readonly T[],
  wd: number,
) => schedule.find((s) => s.days.includes(wd))

/** What to schedule, capped at ``MAX_PENDING`` with the next day's first
 * (see the end). Pure. */
export function planReminders(
  allTasks: readonly Task[],
  allHabits: readonly Habit[],
  now: Date,
  given: MoreReminders = {},
): Planned[] {
  const on = (k: ModuleKey) => given.enabled?.[k] !== false
  const tasks = on("tasks") ? allTasks : []
  const journal = given.journal !== false
  const habits = on("habits")
    ? allHabits.filter((h) => journal || !isJournalHabit(h))
    : []
  const more: MoreReminders = {
    ...given,
    routines: on("habits")
      ? given.routines?.filter(
          (r) => journal || !isJournalRoutine(r, allHabits),
        )
      : [],
    weighIn: on("fitness") ? given.weighIn : null,
    bills: on("finance") ? given.bills : [],
  }
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
  const checkin = more.checkin?.at ? hm(more.checkin.at) : null
  const checkinText = {
    title: "How did today go?",
    body: "Tell Fern in a sentence — it logs it for you.",
    href: "/today/checkin",
  }
  const ask = checkin && onDay(0, checkin)
  if (ask && !inQuiet(ask, more.quiet)) {
    // A repeating trigger can't skip today: dated asks for the days ahead
    // instead (like the weigh-in), so one ignored ask never ends them.
    if (more.checkin?.lastCheckin === today)
      for (let n = 1; n <= 6; n++)
        habitPlans.push({
          id: `checkin-${n}`,
          ...checkinText,
          at: onDay(n, checkin),
        })
    else habitPlans.push({ id: "checkin", ...checkinText, daily: checkin })
  }
  // The coming date (today through six days ahead) on a weekday, and the
  // time an item was moved to on it, if it was.
  const ahead = (wd: number) => (wd - weekday(today) + 7) % 7
  const movedTo = (kind: OverrideKind, id: string, plus: number) => {
    const o = more.overrides?.find(
      (x) =>
        x.kind === kind &&
        x.refId === id &&
        x.day === dayKey(onDay(plus, { hour: 12, minute: 0 })),
    )
    return o ? hm(o.time) : null
  }
  // A moved time before the day start is the small hours after that day.
  const onDayAt = (plus: number, t: { hour: number; minute: number }) =>
    onDay(plus + (t.hour < DAY_START_HOUR ? 1 : 0), t)
  for (const r of more.routines ?? []) {
    if (!r.reminder || r.status !== "active" || !r.steps.length) continue
    for (const slot of r.schedule) {
      const time = slot.time ? hm(slot.time) : null
      if (!time) continue
      for (const day of slot.days) {
        const text = {
          id: `routine-${r.id}-${day}-${slot.time}`,
          title: `${r.icon} ${r.name}`,
          body: `${r.steps.length} steps. Tap to start.`,
          href: `/habits/routines/${r.id}`,
        }
        const n = ahead(day),
          moved =
            slot === firstSlot(r.schedule, day)
              ? movedTo("routine", r.id, n)
              : null
        if (!moved) {
          habitPlans.push({ ...text, weekly: { weekday: day + 1, ...time } })
          continue
        }
        // A repeating trigger can't skip the moved day: that day at the
        // moved time, then dated ones at its own time (the next rebuild
        // puts the weekly one back).
        const at = onDayAt(n, moved)
        if (at > now)
          habitPlans.push({ ...text, id: `${text.id}-moved-${n}`, at })
        habitPlans.push({ ...text, at: onDay(n + 7, time) })
      }
    }
  }
  const nagPlans: Planned[] = []
  for (const h of habits) {
    if (!h.reminder || h.status !== "active") continue
    const log = more.logs?.find((l) => l.habitId === h.id && l.day === today),
      // Done or skipped; a count habit part-way there still needs the nudge.
      doneToday = !!log && (log.status !== "partial" || h.type === "check"),
      // Part-way there today: today's later pushes say how far.
      partial =
        !doneToday && h.type === "count" && log?.value !== undefined
          ? log.value
          : undefined
    if (h.nagEveryMin)
      for (let n = doneToday ? 1 : 0; n < NAG_DAYS; n++) {
        const wd = (weekday(today) + n) % 7
        for (const slot of h.schedule) {
          const own = slot.time ? hm(slot.time) : null
          if (!own || !slot.days.includes(wd)) continue
          // The move is the occurrence the calendar shows: its first slot.
          const moved =
            slot === firstSlot(h.schedule, wd)
              ? movedTo("habit", h.id, n)
              : null
          const due = moved ? onDayAt(n, moved) : onDay(n, own)
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
          body: habitBody(h),
          href: `/habits/${h.id}`,
        }
        const n = ahead(day),
          done = doneToday && n === 0,
          // Today, part-way there: a weekly push can't carry today's count.
          progress = n === 0 && partial !== undefined,
          // The move is the occurrence the calendar shows (its first slot);
          // another slot that day keeps its own reminder.
          moved =
            slot === firstSlot(h.schedule, day)
              ? movedTo("habit", h.id, n)
              : null
        if (!done && !moved && !progress) {
          habitPlans.push({ ...text, weekly: { weekday: day + 1, ...time } })
          continue
        }
        // Moved for that day, or part-way there today (and not already
        // done): that day at its time, saying how far; its own time again
        // from the week after (the next rebuild puts the weekly one back).
        const at = done ? null : moved ? onDayAt(n, moved) : onDay(n, time)
        const body = progress ? habitBody(h, partial) : text.body
        if (at && at > now)
          habitPlans.push({
            ...text,
            body,
            id: moved ? `${text.id}-moved-${n}` : `${text.id}-today`,
            at,
          })
        habitPlans.push({ ...text, at: onDay(n + 7, time) })
      }
    }
  }
  const end = now.getTime() + HORIZON_DAYS * 86_400_000
  // A recurring task's occurrence moved for its day: its reminder moves by
  // as much, and it reads the moved time.
  const shifted = (t: Task) => {
    const o =
      t.dueDate &&
      more.overrides?.find(
        (x) => x.kind === "task" && x.refId === t.id && x.day === t.dueDate,
      )
    if (!o) return null
    const to = mins(o.time),
      from = mins(t.dueTime ?? o.time)
    if (to === null || from === null) return null
    // Only a reminder tied to the occurrence moves with it (at or before its
    // own due time); a snooze, set after, already says when.
    const own = taskDue({ ...t, remindAt: null }, more.defaultRemindTime)
    if (t.remindAt && own && new Date(t.remindAt) > own)
      return { time: o.time, by: 0 }
    const dayMin = (m: number) => (m < DAY_START_HOUR * 60 ? m + 1440 : m)
    return { time: o.time, by: (dayMin(to) - dayMin(from)) * 60_000 }
  }
  const taskPlans: Planned[] = tasks
    .filter((t) => t.status === "open" && t.remindAt)
    .map((t) => {
      const sh = shifted(t)
      const at = new Date(
        new Date(t.remindAt as string).getTime() + (sh?.by ?? 0),
      )
      return { t: sh ? { ...t, dueTime: sh.time } : t, at }
    })
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
    const sh = shifted(t)
    const own = taskDue(t, more.defaultRemindTime)
    const due = own && sh ? new Date(own.getTime() + sh.by) : own
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
    const amount = more.billAmount ? ` · ${more.billAmount(o.amount)}` : ""
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
  const all = [...habitPlans, ...billPlans, ...taskPlans, ...nagPlans]
  if (all.length <= MAX_PENDING) return all
  // Over the cap: everything due in the next day first (repeats after the
  // first reminders), then the soonest after that. A repeating trigger
  // counts by its next firing; whatever is left out is planned again at
  // the next rebuild (any change or app open).
  const nags = new Set(nagPlans)
  const dayAhead = now.getTime() + 86_400_000
  const rank = (p: Planned) => {
    const at = nextFiring(p, now)
    return { tier: at <= dayAhead ? (nags.has(p) ? 1 : 0) : 2, at }
  }
  const ranked = all.map((p, i) => ({ p, i, ...rank(p) }))
  const kept = new Set(
    [...ranked]
      .sort((a, b) => a.tier - b.tier || a.at - b.at || a.i - b.i)
      .slice(0, MAX_PENDING)
      .map((r) => r.i),
  )
  return ranked.filter((r) => kept.has(r.i)).map((r) => r.p)
}

/** When a planned reminder next fires, in ms: its date, or the next
 * matching day and time after ``now`` for a weekly or daily one. */
export function nextFiring(p: Planned, now: Date): number {
  if ("at" in p) return p.at.getTime()
  const t = "weekly" in p ? p.weekly : p.daily
  const plus = "weekly" in p ? (p.weekly.weekday - 1 - now.getDay() + 7) % 7 : 0
  let at = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + plus,
    t.hour,
    t.minute,
  )
  if (at <= now)
    at = new Date(
      at.getFullYear(),
      at.getMonth(),
      at.getDate() + ("weekly" in p ? 7 : 1),
      t.hour,
      t.minute,
    )
  return at.getTime()
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
      enabled: dashStore.get().enabled,
      journal: extrasStore.get().journal,
      checkin: {
        at: dashStore.get().push.checkin ?? "",
        lastCheckin: dashStore.get().push.lastCheckin || null,
      },
      overrides: scheduleStore.get().overrides,
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
  // It's about the food budget: none while Nutrition is off.
  if (dashStore.get().enabled.nutrition === false) return
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

/** The retired 20:30 "streak at risk" reminder (docs/26-retention-algorithms.md
 * D2): the server's best-time nudge replaced it, with no loss-aversion copy.
 * A phone that scheduled one before the update cancels it on launch. */
export const RETIRED_AT_RISK_ID = "streak-at-risk"

export async function cancelRetiredReminders(N: Notifications = load()) {
  await N.cancelScheduledNotificationAsync(RETIRED_AT_RISK_ID).catch(() => {})
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
  void cancelRetiredReminders(N).catch(() => {})
  N.addNotificationResponseReceivedListener((r) => {
    notePushOpen(r.notification.request)
    openNotification(r.notification.request.content.data)
  })
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
  scheduleStore.subscribe(soon)
  // A module switched off or on: rebuild only when a switch moved, not on
  // every other dash change.
  const watched = () => {
    const d = dashStore.get()
    return JSON.stringify([d.enabled, d.push.checkin, d.push.lastCheckin])
  }
  let switches = watched()
  dashStore.subscribe(() => {
    const now = watched()
    if (now === switches) return
    switches = now
    if (dashStore.get().enabled.nutrition === false)
      void N.cancelScheduledNotificationAsync("eat-back").catch(() => {})
    soon()
  })
  // The Journal shown or hidden: same, for its one switch.
  let journal = extrasStore.get().journal
  extrasStore.subscribe(() => {
    if (extrasStore.get().journal === journal) return
    journal = extrasStore.get().journal
    soon()
  })
  soon()
}
