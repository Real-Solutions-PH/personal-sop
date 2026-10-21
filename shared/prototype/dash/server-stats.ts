"use client"
// Server statistics for the dashboard hooks (mobile live mode only).
//
// The backend computes the one aggregate statistic (Life Score, level,
// on-target streaks, facets, metrics, achievements, the merged calendar,
// misses, today's ring). In live mode the mobile app connects a source here
// (mobile/src/live/stats.ts) that fetches those endpoints into ``statsCache``;
// the hooks in ./hooks.ts read it. With no source connected (prototype mode,
// the web app) every hook keeps computing locally, exactly as before.
//
// A cached server value is used only while it is at least as new as the last
// local edit and the device is online. Otherwise (first load in flight, an
// error, offline, an edit not yet synced) the hook falls back to the local
// calculation, so nothing renders empty. The status still tells loading,
// empty and error apart.

import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { CalendarItem, Metric, Miss, ModuleKey } from "../contract"
import { useConnectivity } from "../lib/platform"
import { createStore } from "../lib/store"
import type { RangeKey } from "./hooks"

export interface StatEntry {
  data?: unknown
  /** When ``data`` was fetched (ms since epoch). */
  at?: number
  pending?: boolean
  error?: "offline" | "failed"
  /** A paged list stopped before its last page. */
  truncated?: boolean
}

export const statsCache = createStore<{
  owner: string
  /** Last local edit to a synced store (ms); newer than ``at`` = stale. */
  editedAt: number
  entries: Record<string, StatEntry>
}>("server-stats", () => ({ owner: "", editedAt: 0, entries: {} }))

export interface StatsSource {
  /** A hook needs ``key``: fetch it if missing or stale, keep it fresh. */
  watch(key: string): () => void
  /** The screen showing ``key`` gained focus. */
  touch(key: string): void
}

let source: StatsSource | null = null
const sourceListeners = new Set<() => void>()
export function connectStatsSource(next: StatsSource | null) {
  source = next
  for (const l of sourceListeners) l()
}
const subscribeSource = (l: () => void) => {
  sourceListeners.add(l)
  return () => void sourceListeners.delete(l)
}
const useSource = () =>
  useSyncExternalStore(
    subscribeSource,
    () => source,
    () => null,
  )

// A screen-focus hook (expo-router's useFocusEffect) installed by the mobile
// app before the first render. Installing it later is refused: swapping a
// hook between renders would change the hook order.
type FocusHook = (effect: () => undefined | (() => void)) => void
const noFocus: FocusHook = () => {}
let useFocus: FocusHook = noFocus
let rendered = false
export function installStatsFocus(hook: FocusHook): boolean {
  if (rendered) return false
  useFocus = hook
  return true
}

export type StatStatus = "off" | "loading" | "ready" | "empty" | "error"

export interface ServerStat<T> {
  /** The server value to show, or undefined to show the local one. */
  data: T | undefined
  status: StatStatus
  source: "server" | "local"
}

const isEmpty = (v: unknown) =>
  Array.isArray(v)
    ? v.length === 0
    : !!v &&
      typeof v === "object" &&
      Array.isArray((v as { data?: unknown }).data) &&
      (v as { data: unknown[] }).data.length === 0

/** Pure: what a hook shows for one cache entry. */
export function resolveStat<T>(
  connected: boolean,
  entry: StatEntry | undefined,
  editedAt: number,
  online: boolean,
): ServerStat<T> {
  if (!connected) return { data: undefined, status: "off", source: "local" }
  const has = entry?.data !== undefined
  const status: StatStatus = has
    ? isEmpty(entry?.data)
      ? "empty"
      : "ready"
    : entry?.error
      ? "error"
      : "loading"
  const fresh = has && (entry?.at ?? 0) >= editedAt && online
  return fresh
    ? { data: entry?.data as T, status, source: "server" }
    : { data: undefined, status, source: "local" }
}

/** Read one server statistic; ``key`` null = this call has no server form. */
export function useServerStat<T>(key: string | null): ServerStat<T> {
  rendered = true
  const src = useSource()
  const entry = statsCache.use((s) => (key ? s.entries[key] : undefined))
  const editedAt = statsCache.use((s) => s.editedAt)
  const online = useConnectivity()
  useEffect(() => (src && key ? src.watch(key) : undefined), [src, key])
  const onFocus = useCallback(() => {
    if (src && key) src.touch(key)
    return undefined
  }, [src, key])
  useFocus(onFocus)
  return resolveStat<T>(!!src && !!key, entry, editedAt, online)
}

// ------------------------------------------------------------------ keys

export const RANGE_OF: Record<number, RangeKey> = {
  7: "7d",
  30: "30d",
  90: "90d",
  365: "1y",
}

export const statKey = {
  overview: (range: RangeKey) => `overview:${range}`,
  today: () => "today",
  achievements: () => "achievements",
  calendar: (from: string, to: string) => `calendar:${from}:${to}`,
  misses: (from: string, to: string) => `misses:${from}:${to}`,
  metric: (ref: string) => `metric:${ref}`,
  series: (metric: string, days: number) => `series:${metric}:${days}`,
}

/** The overview key for a hook's ``days``, or null when no range matches. */
export const overviewKey = (days: number) =>
  RANGE_OF[days] ? statKey.overview(RANGE_OF[days]) : null

// --------------------------------------------------- server response shapes

export interface ServerMetric {
  module: string
  key: string
  ref: string
  label: string
  value: string
  number: number | null
  delta: number | null
  good_when: "up" | "down" | null
  shareable: boolean
}

export interface ServerFacet {
  key: string
  label: string
  module: string
  value: number
  prev: number
  off: boolean
  href: string
  metric_keys: string[] | null
  extra: ServerMetric[]
}

export interface ServerRing {
  due: number
  done: number
  per: Record<string, { due: number; done: number }>
}

export interface ServerOverview {
  range: RangeKey
  days: number
  life_score: number | null
  prev_score: number | null
  delta: number | null
  areas: {
    module: string
    enabled: boolean
    weight: number
    rate: number | null
    prev: number | null
  }[]
  on_target: {
    threshold: number
    rate: number | null
    prev_rate: number | null
    on_target: number
    scored: number
    current: number
    best: number
    logged: number
  }
  days_series: {
    day: string
    due: number
    done: number
    on_target: boolean | null
  }[]
  today: ServerRing
  facets: ServerFacet[]
  metrics: ServerMetric[]
}

export interface ServerTrophy {
  id: string
  type: string
  title: string
  value: string
  detail: string
  day: string
  href: string
  share_ref: string | null
  seen: boolean
}

export interface ServerAchievements {
  data: {
    id: string
    type: string
    title: string
    requirement: string
    pct: number
    text: string
    trophy: ServerTrophy | null
  }[]
  trophies: ServerTrophy[]
  unseen: number
}

export interface ServerToday {
  ring: ServerRing
  life_score: number | null
  streak: number
}

export interface ServerBookEntry {
  ref: string
  label: string
  module: string
  value: string
  n: number | null
  unit: string
  good_when: "up" | "down"
  shareable: boolean
  delta: number | null
}

export interface ServerMetricDetail {
  ref: string
  week: ServerBookEntry | null
  month: ServerBookEntry | null
}

export interface ServerCalendarItem {
  id: string
  day: string
  time: string | null
  title: string
  module: string
  done: boolean | null
  href: string
}

export interface ServerMiss {
  id: string
  day: string
  title: string
  module: string
  href: string
  kind: string
  note: string | null
}

// ------------------------------------------------------- shape translators

export const MODULES: ModuleKey[] = ["habits", "tasks", "fitness", "finance"]
const isModule = (m: string): m is ModuleKey =>
  (MODULES as string[]).includes(m)

export function metricFrom(m: ServerMetric): Metric {
  const out: Metric = {
    key: m.key,
    label: m.label,
    value: m.value,
    shareable: m.shareable,
  }
  if (m.delta !== null) out.delta = m.delta
  if (m.good_when) out.goodWhen = m.good_when
  return out
}

export function ratesFrom(o: ServerOverview, which: "rate" | "prev") {
  const out = { habits: 0, tasks: 0, fitness: 0, finance: 0 }
  for (const a of o.areas) if (isModule(a.module)) out[a.module] = a[which] ?? 0
  return out as Record<ModuleKey, number>
}

export function metricsFrom(o: ServerOverview): Record<ModuleKey, Metric[]> {
  const out: Record<ModuleKey, Metric[]> = {
    habits: [],
    tasks: [],
    fitness: [],
    finance: [],
  }
  for (const m of o.metrics)
    if (isModule(m.module)) out[m.module].push(metricFrom(m))
  return out
}

export function seriesFrom(o: ServerOverview) {
  return o.days_series.map((d) => ({
    day: d.day,
    due: d.due,
    done: d.done,
    onTarget: d.on_target,
  }))
}

export function calendarFrom(rows: ServerCalendarItem[]): CalendarItem[] {
  return rows.flatMap((r) => {
    if (!isModule(r.module)) return []
    const item: CalendarItem = {
      id: r.id,
      day: r.day,
      title: r.title,
      module: r.module,
      href: r.href,
    }
    if (r.time) item.time = r.time
    if (r.done !== null) item.done = r.done
    return [item]
  })
}

export function missesFrom(rows: ServerMiss[]): Miss[] {
  return rows.flatMap((r) =>
    isModule(r.module)
      ? [
          {
            id: r.id,
            day: r.day,
            title: r.title,
            module: r.module,
            href: r.href,
          },
        ]
      : [],
  )
}

export function ringFrom(r: ServerRing) {
  const per = {} as Record<ModuleKey, { due: number; done: number }>
  for (const k of MODULES) per[k] = r.per[k] ?? { due: 0, done: 0 }
  return { due: r.due, done: r.done, per }
}
