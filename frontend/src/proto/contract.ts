import type { ComponentType } from "react"

// The seam between feature modules (habits, tasks, fitness, finance) and the
// cross-cutting surfaces (Today, Plan calendar, Stats / Life Score, Capture).
// Each module's index.ts exports `module: ModuleContract`.

export type ModuleKey = "habits" | "tasks" | "fitness" | "finance"

export interface Metric {
  key: string
  label: string
  /** Pre-formatted for display, e.g. "86%", "12-day", "102.5 kg". Never ₱ if shareable. */
  value: string
  /** Signed change vs previous period, in the metric's own unit. */
  delta?: number
  goodWhen?: "up" | "down"
  /** Safe to put on a public share card (no ₱, no body weight unless opted in). */
  shareable: boolean
}

export interface CalendarItem {
  id: string
  day: string // dayKey YYYY-MM-DD
  time?: string // HH:mm
  title: string
  module: ModuleKey
  done?: boolean
  href: string
}

export interface Miss {
  id: string
  day: string
  title: string // "Missed: Read 20 pages", "Over food budget by 12%"
  module: ModuleKey
  href: string
}

export interface ModuleContract {
  key: ModuleKey
  label: string
  /** Card(s) for the Today dashboard; render null when nothing to show.
   *  `evening` = the wrap-up layout (IA §6): state results against targets. */
  TodayCard: ComponentType<{ evening?: boolean }>
  /** 0..1 performance for the Life Score over `days` days ending `offset`
   *  days before today (offset = days → the previous equal period). */
  useAreaRate: (days: number, offset?: number) => number
  /** Headline metrics for Stats (period = last `days` days vs the previous `days`). */
  useMetrics: (days: number) => Metric[]
  /** Items for the Plan calendar within [from, to] day keys. */
  useCalendar: (from: string, to: string) => CalendarItem[]
  /** Misses & leaks for honest reflection in [from, to]. */
  useMisses: (from: string, to: string) => Miss[]
  /** Due/done counts for today — feeds the Today day ring and on-target rate. */
  useTodayProgress: () => { due: number; done: number }
  /** Module home / analytics route. */
  href: string
}
