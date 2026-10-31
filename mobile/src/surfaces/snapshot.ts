import type { DashState } from "@domain/dash/data"
import * as N from "@domain/finance/calc"
import type { FinState } from "@domain/finance/data"
import * as F from "@domain/fitness/calc"
import type { FitnessState } from "@domain/fitness/data"
import type { HabitsState } from "@domain/habits/data"
import * as H from "@domain/habits/logic"
import { DAY_START_HOUR, dayKey } from "@domain/lib/day"
import type { Live } from "@domain/lib/live"
import { money } from "@domain/lib/money"
import type { TasksState } from "@domain/tasks/data"
import { byDue, fmtDay, isOverdue } from "@domain/tasks/logic"
import {
  type AppKey,
  SNAPSHOT_VERSION,
  type WidgetHabit,
  type WidgetSnapshot,
  type WidgetTask,
} from "./types"

/** The parts of the app the widgets show. ``ring``, ``lifeScore`` and
 * ``streak`` come from the dashboard hooks (they prefer the server's numbers
 * in live mode), so the widget reads what Today reads. */
export interface SnapshotInput {
  habits: HabitsState
  tasks: TasksState
  fit: FitnessState
  fin: FinState
  dash: Pick<DashState, "targetThreshold" | "enabled">
  live: Live | null
  privacy: boolean
  ring: { done: number; due: number }
  lifeScore: number | null
  streak: number
  /** Journal is shown (an "extra" the person can hide). */
  journal: boolean
  /** This build can read Screen Time (the native module is present). */
  screenTime: boolean
  now?: Date
}

const HABITS_MAX = 6
const TASKS_MAX = 5

export function dayHeadline(done: number, due: number, target: number) {
  const need = Math.max(0, Math.ceil(due * target) - done)
  if (!due) return "Free day"
  if (done >= due) return "Day complete"
  if (!need) return "Target hit"
  return `${need} to target`
}

function habitsPart(s: HabitsState, now: Date): WidgetSnapshot["habits"] {
  const today = dayKey(now)
  const idx = H.logIndex(s.logs)
  const due = H.sortedHabits(
    s.habits.filter((h) => h.status !== "archived" && H.isDue(h, today)),
  )
  const status = (id: string) => idx.get(H.lk(id, today))?.status
  const open = due.filter((h) => status(h.id) !== "skipped")
  const done = open.filter((h) => status(h.id) === "done").length
  const order = { now: 0, later: 1, anytime: 2, done: 3 } as const
  const items: WidgetHabit[] = open
    .map((h) => {
      const group = H.todayGroup(h, idx.get(H.lk(h.id, today)), today, now)
      return {
        h,
        group,
        time: H.slotFor(h.schedule, today)?.time,
      }
    })
    .sort(
      (a, b) =>
        order[a.group] - order[b.group] ||
        H.toMin(a.time ?? "99:99") - H.toMin(b.time ?? "99:99"),
    )
    .slice(0, HABITS_MAX)
    .map(({ h, group, time }) => ({
      id: h.id,
      name: h.name,
      icon: h.icon,
      streak: H.streaks(h, idx, today).current,
      done: group === "done",
      ...(time ? { time } : {}),
      checkable: h.type === "check" && !h.rule,
    }))
  return { done, total: open.length, items }
}

function tasksPart(s: TasksState, now: Date): WidgetSnapshot["tasks"] {
  const tk = dayKey(now)
  const hidden = new Set(
    s.lists
      .filter((l) => l.kind === "shopping" || l.archivedAt)
      .map((l) => l.id),
  )
  const open = s.tasks.filter(
    (t) => t.status === "open" && !(t.listId && hidden.has(t.listId)),
  )
  const overdue = open.filter((t) => isOverdue(t, tk))
  const soon = open
    .filter((t) => t.dueDate && t.dueDate >= tk)
    .sort(byDue)
    .slice(0, TASKS_MAX)
  const items: WidgetTask[] = [...overdue.sort(byDue), ...soon]
    .slice(0, TASKS_MAX)
    .map((t) => {
      const late = isOverdue(t, tk)
      const day = t.dueDate ? fmtDay(t.dueDate, tk) : ""
      return {
        id: t.id,
        title: t.title,
        when: late ? "Overdue" : t.dueTime ? `${day} ${t.dueTime}` : day,
        overdue: late,
      }
    })
  return {
    open: open.filter((t) => t.dueDate && t.dueDate <= tk).length,
    overdue: overdue.length,
    items,
  }
}

function macrosPart(s: FitnessState, now: Date): WidgetSnapshot["macros"] {
  const day = dayKey(now)
  const target = F.budgetFor(s, day)
  if (!target) return null
  const { totals, count } = F.dayTotals(s, day)
  const part = (k: "kcal" | "protein" | "carbs" | "fat") => ({
    eaten: Math.round(totals[k]),
    target: Math.round(target[k]),
  })
  return {
    kcal: part("kcal"),
    protein: part("protein"),
    carbs: part("carbs"),
    fat: part("fat"),
    meals: count,
  }
}

function moneyPart(s: FinState, hidden: boolean): WidgetSnapshot["money"] {
  const overall = s.budgets.find((b) => !b.archived && b.categoryIds === null)
  if (!overall) return null
  const v = N.budgetView(s, overall)
  const show = (n: number) => (hidden ? "••••" : money(n))
  return {
    safeToday: show(v.safePerDay),
    left: show(Math.max(0, v.limit - v.spent)),
    spent: show(v.spent),
    limit: show(v.limit),
    pct: Math.max(0, Math.min(1, v.limit ? v.spent / v.limit : 0)),
    daysLeft: v.daysLeft,
    hidden,
  }
}

const LIVE_KIND = {
  routine: "routine",
  workout: "workout",
  timer: "timer",
  // The widget draws a running focus session as a timer (ADR-0025).
  focus: "timer",
} as const

/** The in-app launcher's order (AppLauncher in src/prototype/app-launcher.tsx). */
const APP_ORDER: AppKey[] = [
  "habits",
  "tasks",
  "fitness",
  "nutrition",
  "focus",
  "finance",
  "screen",
  "journal",
]

/** The apps the launcher shows: the enabled modules, and Journal unless it
 * is hidden. Screen Time also needs a build that can read it, since the
 * widget's tile would otherwise open a locked preview. */
export function launcherApps(
  enabled: Record<string, boolean | undefined>,
  journal: boolean,
  screenTime: boolean,
): AppKey[] {
  return APP_ORDER.filter((k) =>
    k === "journal"
      ? journal
      : k === "screen"
        ? screenTime && !!enabled[k]
        : !!enabled[k],
  )
}

/** The next moment the app's day turns over (4:00 local). */
export function dayEndsAfter(now: Date): Date {
  const end = new Date(now)
  end.setHours(DAY_START_HOUR, 0, 0, 0)
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1)
  return end
}

export function buildSnapshot(input: SnapshotInput): WidgetSnapshot {
  const now = input.now ?? new Date()
  const { ring, dash } = input
  const pct = ring.due ? Math.min(1, ring.done / ring.due) : 1
  return {
    v: SNAPSHOT_VERSION,
    at: now.toISOString(),
    day: dayKey(now),
    dayEnds: dayEndsAfter(now).toISOString(),
    today: {
      done: ring.done,
      due: ring.due,
      pct,
      target: dash.targetThreshold,
      headline: dayHeadline(ring.done, ring.due, dash.targetThreshold),
      lifeScore: input.lifeScore,
      streak: input.streak,
    },
    habits: dash.enabled.habits
      ? habitsPart(input.habits, now)
      : { done: 0, total: 0, items: [] },
    macros: dash.enabled.nutrition ? macrosPart(input.fit, now) : null,
    tasks: dash.enabled.tasks
      ? tasksPart(input.tasks, now)
      : { open: 0, overdue: 0, items: [] },
    money: dash.enabled.finance ? moneyPart(input.fin, input.privacy) : null,
    live: input.live
      ? {
          kind: LIVE_KIND[input.live.kind],
          title: input.live.label,
          href: input.live.href,
        }
      : null,
    apps: launcherApps(dash.enabled, input.journal, input.screenTime),
  }
}

/** The snapshot without its write time, to tell whether anything a widget
 * shows has changed. */
export const snapshotKey = (s: WidgetSnapshot) =>
  JSON.stringify({ ...s, at: undefined })
