// What the productivity share cards count (tasks, Focus, journal, a habit,
// finance), as pure functions over the device's records, so tests pin the
// numbers and the cards only lay them out. Finance figures come out as
// shares and ratios only: no amount leaves this file.

import type { JournalEntry } from "@domain/capture/data"
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import * as FC from "@domain/focus/calc"
import type { FocusState } from "@domain/focus/data"
import * as FL from "@domain/focus/logic"
import type { Habit, HabitLog } from "@domain/habits/data"
import * as HL from "@domain/habits/logic"
import type { Task, TasksState } from "@domain/tasks/data"
import { addDays as taskAddDays } from "@domain/tasks/logic"
import type { Span } from "./share-viz"

// ---------------------------------------------------------------- tasks

/** Tasks the person can see on Today: not deleted, not on a shopping or an
 * archived list. */
function visible(s: TasksState): Task[] {
  const hidden = new Set(
    s.lists
      .filter((l) => l.kind === "shopping" || l.archivedAt)
      .map((l) => l.id),
  )
  return s.tasks.filter(
    (t) => t.status !== "deleted" && !(t.listId && hidden.has(t.listId)),
  )
}
const localDay = (iso: string) => {
  const d = new Date(iso),
    two = (v: number) => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
export type TodayCompletion = {
  /** Due today, plus the ones moved off today today. */
  planned: number
  done: number
  /** Moved from today to a later day, today, and not done since. */
  moved: number
  /** Still due today and not done. */
  open: number
  /** Overdue tasks from earlier days finished today: extra, not planned. */
  catchUp: number
}
/** Today's tasks as a whole: done, moved to later days, and still open. */
export function todayCompletion(s: TasksState, today: string): TodayCompletion {
  const tasks = visible(s),
    byId = new Map(tasks.map((t) => [t.id, t]))
  const movedIds = new Set<string>()
  for (const e of s.events)
    if (
      (e.type === "rescheduled" || e.type === "snoozed") &&
      e.fromDue === today &&
      e.toDue &&
      e.toDue > today &&
      localDay(e.at) === today
    )
      movedIds.add(e.taskId)
  const dueToday = tasks.filter((t) => t.dueDate === today)
  // A task moved away and then brought back to today counts once, as due.
  for (const t of dueToday) movedIds.delete(t.id)
  for (const id of [...movedIds]) if (!byId.has(id)) movedIds.delete(id)
  const done = dueToday.filter((t) => t.status === "done").length
  const catchUp = tasks.filter(
    (t) =>
      t.status === "done" &&
      !!t.completedAt &&
      localDay(t.completedAt) === today &&
      !!t.dueDate &&
      t.dueDate < today,
  ).length
  return {
    planned: dueToday.length + movedIds.size,
    done,
    moved: movedIds.size,
    open: dueToday.length - done,
    catchUp,
  }
}

export type TaskTime = {
  id: string
  title: string
  sec: number
  done: boolean
}
/** Focus time on each task today (from Focus sessions linked to a task),
 * most first, and the average over the tasks that got any. */
export function taskFocusToday(
  focus: FocusState,
  tasks: TasksState,
  today: string,
  now = Date.now(),
): { rows: TaskTime[]; avgSec: number; totalSec: number } {
  const r = FC.rangeStats(focus, today, today, now),
    byId = new Map(tasks.tasks.map((t) => [t.id, t]))
  const rows = FC.itemTotals(r.spans.filter((f) => f.item?.kind === "task"))
    .filter((x) => x.item && x.sec >= 60)
    .map((x) => {
      const id = x.item?.id ?? "",
        t = byId.get(id)
      return {
        id,
        title: t?.title ?? x.item?.title ?? "A task",
        sec: x.sec,
        done: t?.status === "done",
      }
    })
  const totalSec = rows.reduce((n, x) => n + x.sec, 0)
  return {
    rows,
    totalSec,
    avgSec: rows.length ? Math.round(totalSec / rows.length) : 0,
  }
}

// ---------------------------------------------------------------- focus

export type FocusDay = {
  day: string
  mode: "pomodoro" | "stopwatch"
  sessions: number
  /** Finished Pomodoros (a full focus set). */
  sets: number
  focusSec: number
  breakSec: number
  pauseSec: number
  /** The longest single session's focus. */
  longestSec: number
  spans: Span[]
  /** Focus by what it was on, most first ("" = nothing picked). */
  items: { name: string; sec: number }[]
  goalSec: number
}
/** One day of one timer mode: its sessions, focus against break and pause,
 * and the timeline. Abandoned sessions do not count. */
export function focusDay(
  s: FocusState,
  day: string,
  mode: "pomodoro" | "stopwatch",
  now = Date.now(),
): FocusDay {
  const lo = FL.dayStart(day),
    hi = FL.dayStart(FL.nextDay(day))
  const tls = FC.timelines(s, lo, hi, now).filter(
    (tl) => tl.sess.mode === mode && tl.sess.endReason !== "abandoned",
  )
  const spans: Span[] = []
  let breakSec = 0,
    pauseSec = 0,
    longestSec = 0,
    sets = 0
  for (const tl of tls) {
    let own = 0
    for (const g of tl.segs)
      for (const [a, b] of FL.clip([[g.start, FL.endOf(g, now)]], lo, hi)) {
        if (b <= a) continue
        spans.push({ start: a, end: b, kind: g.kind })
        if (g.kind === "break") breakSec += (b - a) / 1000
        else if (g.kind === "pause") pauseSec += (b - a) / 1000
        else own += (b - a) / 1000
      }
    longestSec = Math.max(longestSec, Math.floor(own))
    if (mode === "pomodoro") sets += FL.setsCompleted(tl, now)
  }
  const counted = FL.counted(tls, now)
    .filter((f) => f.end > lo && f.start < hi)
    .map((f) => ({
      ...f,
      start: Math.max(f.start, lo),
      end: Math.min(f.end, hi),
    }))
  const items = FC.itemTotals(counted).map((x) => ({
    name: x.item?.title ?? "",
    sec: x.sec,
  }))
  return {
    day,
    mode,
    sessions: tls.length,
    sets,
    focusSec: FL.perDay(counted, day, day)[day] ?? 0,
    breakSec: Math.floor(breakSec),
    pauseSec: Math.floor(pauseSec),
    longestSec,
    spans: spans.sort((a, b) => a.start - b.start),
    items,
    goalSec: FC.goalSec(s),
  }
}

// --------------------------------------------------------------- journal

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
export type JournalTime = {
  totalSec: number
  todaySec: number
  weekSec: number
  monthSec: number
  /** The last 7 days, oldest first, ending today. */
  last7: { day: string; sec: number }[]
  /** The first day typing time was counted, or null before any. */
  since: string | null
}
/** Time spent writing, from the per-day seconds the journal editor counts
 * while the person types (journal-time.ts). Week is the last 7 days and
 * month the last 30, both including today. */
export function journalTime(
  days: Record<string, number>,
  since: string | null,
  today: string,
): JournalTime {
  const sum = (from: string) =>
    Object.entries(days)
      .filter(([d]) => d >= from && d <= today)
      .reduce((n, [, v]) => n + v, 0)
  return {
    totalSec: Object.values(days).reduce((n, v) => n + v, 0),
    todaySec: days[today] ?? 0,
    weekSec: sum(taskAddDays(today, -6)),
    monthSec: sum(taskAddDays(today, -29)),
    last7: Array.from({ length: 7 }, (_, i) => {
      const day = taskAddDays(today, i - 6)
      return { day, sec: days[day] ?? 0 }
    }),
    since,
  }
}
export type JournalWords = {
  total: number
  todayWords: number
  /** The average over the days that have an entry. */
  perDay: number
  daysWritten: number
  /** The last 7 days, oldest first, ending today. */
  last7: { day: string; words: number }[]
  best: number
}
/** Words written in the journal: all of it, today, and per day. */
export function journalWords(
  entries: Pick<JournalEntry, "day" | "body">[],
  today: string,
): JournalWords {
  const byDay = new Map<string, number>()
  for (const e of entries)
    byDay.set(e.day, (byDay.get(e.day) ?? 0) + words(e.body))
  const total = [...byDay.values()].reduce((n, v) => n + v, 0),
    daysWritten = [...byDay.values()].filter((v) => v > 0).length
  return {
    total,
    todayWords: byDay.get(today) ?? 0,
    perDay: daysWritten ? Math.round(total / daysWritten) : 0,
    daysWritten,
    last7: Array.from({ length: 7 }, (_, i) => {
      const day = taskAddDays(today, i - 6)
      return { day, words: byDay.get(day) ?? 0 }
    }),
    best: Math.max(0, ...byDay.values()),
  }
}

// ----------------------------------------------------------------- habit

/** One habit's history: its completion rate each week (Monday to Sunday,
 * the last week ending today), oldest first; null for a week it was never
 * due. ``total`` is every day it was done since it began. */
export function habitWeeks(
  h: Habit,
  idx: Map<string, HabitLog>,
  today: string,
  weeks = 8,
): { rates: (number | null)[]; total: number } {
  const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7,
    monday = taskAddDays(today, -dow)
  const rates = Array.from({ length: weeks }, (_, i) => {
    const from = taskAddDays(monday, (i - weeks + 1) * 7),
      to = taskAddDays(from, 6)
    if (to < h.createdAt) return null
    const st = HL.habitStats(h, idx, from, to, today),
      due = st.scheduled - st.skipped
    return due > 0 ? st.done / due : null
  })
  const all = HL.habitStats(h, idx, h.createdAt, today, today)
  return { rates, total: all.done + all.bonus }
}

// --------------------------------------------------------------- finance

export type FinanceShares = {
  /** Savings rate per budget month, oldest first, ending this month: null
   * for a month with no income. */
  savings: { month: string; rate: number | null }[]
  /** Each live budget this month: its share used against the share of the
   * month gone. */
  budgets: { name: string; used: number; pace: number }[]
  /** Spending by top category as a share of all spending this month. */
  shares: { name: string; share: number }[]
  /** Days this month with no discretionary spending. */
  noSpend: {
    days: { key: string; free: boolean }[]
    count: number
    streak: number
  }
  month: string
  from: string
  to: string
}
/** The finance cards' figures: every one a share or a ratio. */
export function financeShares(s: FinState, today = N.today()): FinanceShares {
  const sd = s.settings.monthStartDay,
    month = N.monthOf(today, sd),
    [from, to] = N.monthRange(month, sd),
    cats = N.catMap(s)
  const savings = [-5, -4, -3, -2, -1, 0].map((i) => {
    const mk = N.addMonths(month, i),
      [f, t] = N.monthRange(mk, sd),
      flow = N.flowIn(s, f, t > today ? today : t)
    return { month: mk, rate: flow.income > 0 ? N.savingsRate(flow) : null }
  })
  const flow = N.flowIn(s, from, today),
    spend = [...flow.byCat.values()]
      .filter((v) => v > 0)
      .reduce((a, b) => a + b, 0)
  const shares = [...flow.byCat.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, v]) => ({
      name: id === "uncat" ? "Uncategorised" : (cats.get(id)?.name ?? "Other"),
      share: spend > 0 ? v / spend : 0,
    }))
  const budgets = s.budgets
    .filter((b) => !b.archived)
    .map((b) => {
      const v = N.budgetView(s, b, month)
      return { name: b.name, used: v.pct, pace: v.pace }
    })
  return {
    savings,
    budgets,
    shares,
    noSpend: N.noSpendDays(s, from, to),
    month,
    from,
    to,
  }
}
