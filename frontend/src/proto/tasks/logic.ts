import { dayKey, weekday } from "../lib/day"
import type { Recurrence, RepeatRule, Task, TaskList, TasksState } from "./data"

// Pure helpers: day-key math, formatting, recurrence, metrics (IA §7).

const pad = (n: number) => String(n).padStart(2, "0")
const keyOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const dateOf = (key: string) => new Date(`${key}T12:00:00`)

export const today = () => dayKey()

export function addDays(key: string, n: number): string {
  const d = dateOf(key)
  d.setDate(d.getDate() + n)
  return keyOf(d)
}

/** b − a in whole days. */
export function diffDays(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86_400_000)
}

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MO = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]
export const WEEKDAYS = WD

export function fmtDate(key: string): string {
  const d = dateOf(key)
  return `${MO[d.getMonth()]} ${d.getDate()}`
}

/** "Today", "Tomorrow", "Yesterday", "Fri", "Oct 12". */
export function fmtDay(key: string, t = today()): string {
  const n = diffDays(t, key)
  if (n === 0) return "Today"
  if (n === 1) return "Tomorrow"
  if (n === -1) return "Yesterday"
  if (n > 1 && n < 7) return WD[weekday(key)]
  return fmtDate(key)
}

export function fmtDayLong(key: string, t = today()): string {
  const d = dateOf(key)
  const rel = fmtDay(key, t)
  const base = `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`
  return rel === "Today" || rel === "Tomorrow" || rel === "Yesterday"
    ? `${rel} · ${base}`
    : base
}

export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const ap = h >= 12 ? "PM" : "AM"
  const h12 = h % 12 || 12
  return m ? `${h12}:${pad(m)} ${ap}` : `${h12} ${ap}`
}

export function fmtInstant(iso: string): string {
  const d = new Date(iso)
  return `${fmtDay(dayKey(d))} ${fmtTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`
}

/** ISO for a logical day + HH:mm. */
export function isoAt(key: string, hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  const d = dateOf(key)
  d.setHours(h, m, 0, 0)
  // hours before the day boundary belong to the next calendar date
  if (h < 4) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

// ---------------------------------------------------------------- recurrence

export function fmtRepeat(r: Recurrence | null): string | null {
  if (!r) return null
  const rule = r.rule
  const base =
    rule.kind === "daily"
      ? "Daily"
      : rule.kind === "weekdays"
        ? "Weekdays"
        : rule.kind === "weekly"
          ? `Weekly · ${rule.days.map((d) => WD[d]).join(", ")}`
          : rule.kind === "monthly"
            ? `Monthly · day ${rule.day}`
            : `Every ${rule.n} days`
  return r.mode === "after" ? `${base} after done` : base
}

function matches(rule: RepeatRule, key: string, anchor: string): boolean {
  const wd = weekday(key)
  switch (rule.kind) {
    case "daily":
      return true
    case "weekdays":
      return wd > 0 && wd < 6
    case "weekly":
      return rule.days.includes(wd)
    case "monthly":
      return dateOf(key).getDate() === rule.day
    case "everyN":
      return diffDays(anchor, key) % rule.n === 0
  }
}

/** Next due date for a recurring task completed on `doneDay` (IA §8: no pile-up). */
export function nextDue(r: Recurrence, due: string, doneDay: string): string {
  if (r.mode === "after") {
    const step =
      r.rule.kind === "everyN"
        ? r.rule.n
        : r.rule.kind === "monthly"
          ? 30
          : r.rule.kind === "weekly"
            ? 7
            : 1
    return addDays(doneDay, step)
  }
  let k = addDays(due > doneDay ? due : doneDay, 1)
  for (let i = 0; i < 400; i++, k = addDays(k, 1))
    if (matches(r.rule, k, due)) return k
  return addDays(doneDay, 1)
}

// ---------------------------------------------------------------- selectors

export const isShopping = (lists: TaskList[], listId: string | null) =>
  !!listId && lists.find((l) => l.id === listId)?.kind === "shopping"

export const doneDay = (t: Task) =>
  t.completedAt ? dayKey(new Date(t.completedAt)) : null

export const isOverdue = (t: Task, tk = today()) =>
  t.status === "open" && !!t.dueDate && t.dueDate < tk

/** Open timed task whose time has passed today — "due now" fallback badge (F-TSK-42). */
export function isDueNow(t: Task, now = new Date()): boolean {
  if (t.status !== "open" || !t.dueDate || !t.dueTime) return false
  if (t.dueDate !== dayKey(now)) return false
  return new Date(isoAt(t.dueDate, t.dueTime)).getTime() <= now.getTime()
}

/** Sort: starred first, then timed by time, then untimed, then manual order. */
export function byDue(a: Task, b: Task): number {
  if ((a.dueDate ?? "9") !== (b.dueDate ?? "9"))
    return (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1
  if (a.starred !== b.starred) return a.starred ? -1 : 1
  if ((a.dueTime ?? "99") !== (b.dueTime ?? "99"))
    return (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : 1
  return a.order - b.order
}

export const live = (s: TasksState) =>
  s.tasks.filter((t) => t.status !== "deleted")

export function listName(lists: TaskList[], id: string | null): string {
  if (!id) return "Inbox"
  return lists.find((l) => l.id === id)?.name ?? "Inbox"
}

// ---------------------------------------------------------------- metrics (§7)

export interface TaskStats {
  from: string
  to: string
  done: number
  onTime: number
  late: number
  withDue: number
  onTimeRate: number | null
  streak: number
  bestStreak: number
  clearDays: number
  dueDays: number
  overdueNow: number
  reschedules: number
  avgReschedules: number
  avgLateness: number | null
  followThrough: number
  captureShare: number | null
  created: number
  perDay: { day: string; done: number }[]
  byList: { id: string | null; name: string; done: number }[]
  topPushed: Task[]
}

export function computeStats(
  s: TasksState,
  from: string,
  to: string,
  tk = today(),
): TaskStats {
  const shop = (t: Task) => isShopping(s.lists, t.listId)
  const counted = (t: Task) => s.settings.countGroceries || !shop(t)
  const inRange = (k: string | null) => !!k && k >= from && k <= to
  const done = s.tasks.filter(
    (t) => t.status === "done" && inRange(doneDay(t)) && counted(t),
  )
  const withDueDone = done.filter((t) => t.dueDate && !shop(t))
  const onTime = withDueDone.filter(
    (t) => (doneDay(t) ?? "") <= (t.dueDate ?? ""),
  )
  const lateTasks = withDueDone.length - onTime.length

  // streak (all history, ending today or yesterday)
  const days = new Set(
    s.tasks.filter((t) => t.status === "done").map((t) => doneDay(t) ?? ""),
  )
  let streak = 0
  let k = days.has(tk) ? tk : addDays(tk, -1)
  while (days.has(k)) {
    streak++
    k = addDays(k, -1)
  }
  let best = 0
  let run = 0
  const sorted = [...days].filter(Boolean).sort()
  sorted.forEach((d, i) => {
    run = i && diffDays(sorted[i - 1], d) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  })

  // clear days
  let clearDays = 0
  let dueDays = 0
  for (let d = from; d <= to && d <= tk; d = addDays(d, 1)) {
    const due = s.tasks.filter(
      (t) => t.status !== "deleted" && t.dueDate === d && !shop(t),
    )
    if (!due.length) continue
    const clear = due.every(
      (t) => t.status === "done" && (doneDay(t) ?? "") <= d,
    )
    if (d === tk && !clear) continue // today still in play
    dueDays++
    if (clear) clearDays++
  }

  const overdueNow = s.tasks.filter((t) => isOverdue(t, tk) && !shop(t)).length
  const resched = s.events.filter(
    (e) => e.type === "rescheduled" && inRange(dayKey(new Date(e.at))),
  ).length
  const lateness = done
    .filter(
      (t) => t.originalDue && !shop(t) && (doneDay(t) ?? "") > t.originalDue,
    )
    .map((t) => diffDays(t.originalDue ?? "", doneDay(t) ?? ""))
  const created = s.tasks.filter((t) => inRange(dayKey(new Date(t.createdAt))))

  const perDay: { day: string; done: number }[] = []
  for (let d = from; d <= to; d = addDays(d, 1))
    perDay.push({ day: d, done: done.filter((t) => doneDay(t) === d).length })

  const listIds: (string | null)[] = [...s.lists.map((l) => l.id), null]
  const byList = listIds
    .map((id) => ({
      id,
      name: listName(s.lists, id),
      done: done.filter((t) => t.listId === id).length,
    }))
    .filter((x) => x.done > 0)
    .sort((a, b) => b.done - a.done)

  const topPushed = s.tasks
    .filter((t) => t.status !== "deleted" && t.rescheduleCount > 0)
    .sort((a, b) => b.rescheduleCount - a.rescheduleCount)
    .slice(0, 3)

  return {
    from,
    to,
    done: done.length,
    onTime: onTime.length,
    late: lateTasks,
    withDue: withDueDone.length,
    onTimeRate: withDueDone.length ? onTime.length / withDueDone.length : null,
    streak,
    bestStreak: Math.max(best, streak),
    clearDays,
    dueDays,
    overdueNow,
    reschedules: resched,
    avgReschedules: done.length
      ? done.reduce((a, t) => a + t.rescheduleCount, 0) / done.length
      : 0,
    avgLateness: lateness.length
      ? lateness.reduce((a, b) => a + b, 0) / lateness.length
      : null,
    followThrough:
      (onTime.length + 0.5 * lateTasks) / Math.max(1, overdueNow + resched),
    captureShare: created.length
      ? created.filter((t) => t.source !== "manual").length / created.length
      : null,
    created: created.length,
    perDay,
    byList,
    topPushed,
  }
}

export const pct = (v: number | null) =>
  v === null ? "—" : `${Math.round(v * 100)}%`
