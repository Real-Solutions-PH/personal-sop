"use client"
import { useMemo } from "react"
import type {
  CalendarItem,
  Metric,
  Miss,
  ModuleContract,
  ModuleKey,
} from "../contract"
import { dayKey, dayOffset } from "../lib/day"
import { modules } from "../modules"
import {
  AREA,
  type Goal,
  type MetricRef,
  MODULE_KEYS,
  type ShareTemplate,
} from "./data"
import {
  calendarFrom,
  metricsFrom,
  missesFrom,
  overviewKey,
  ratesFrom,
  ringFrom,
  type ServerAchievements,
  type ServerCalendarItem,
  type ServerMetricDetail,
  type ServerMiss,
  type ServerOverview,
  type ServerToday,
  seriesFrom,
  statKey,
  useServerStat,
} from "./server-stats"
import { dashStore } from "./store"

const byKey = Object.fromEntries(modules.map((m) => [m.key, m])) as Record<
  ModuleKey,
  ModuleContract
>
const HAB = byKey.habits
const TSK = byKey.tasks
const FIT = byKey.fitness
const NUT = byKey.nutrition
const FOC = byKey.focus
const FIN = byKey.finance
const SCR = byKey.screen

export { byKey as moduleByKey }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
export const useEnabled = () => dashStore.use((s) => s.enabled)
export const useWeights = () => dashStore.use((s) => s.weights)
export function useEnabledKeys(): ModuleKey[] {
  const e = useEnabled()
  return useMemo(() => MODULE_KEYS.filter((k) => e[k]), [e])
}
/** The device's own rates; ``rated`` is false for an area with nothing to
 * rate, which reads as 0 but is left out of the Life Score. */
function useLocalRates(days: number, offset: number) {
  const h = HAB.useAreaRate(days, offset)
  const t = TSK.useAreaRate(days, offset)
  const f = FIT.useAreaRate(days, offset)
  const n = NUT.useAreaRate(days, offset)
  const fo = FOC.useAreaRate(days, offset)
  const fi = FIN.useAreaRate(days, offset)
  const sc = SCR.useAreaRate(days, offset)
  return useMemo(() => {
    const raw: Record<ModuleKey, number | null> = {
      habits: h,
      tasks: t,
      fitness: f,
      nutrition: n,
      focus: fo,
      finance: fi,
      screen: sc,
    }
    const rates = {} as Record<ModuleKey, number>
    const rated = {} as Record<ModuleKey, boolean>
    for (const k of MODULE_KEYS) {
      rates[k] = raw[k] ?? 0
      rated[k] = raw[k] !== null
    }
    return { rates, rated }
  }, [h, t, f, n, fo, fi, sc])
}
export function useAreaRates(
  days: number,
  offset = 0,
): Record<ModuleKey, number> {
  const local = useLocalRates(days, offset).rates
  // Live mode: the server's area rates for this range (offset = the range's
  // own length is the previous period).
  const server = useServerStat<ServerOverview>(
    offset === 0 || offset === days ? overviewKey(days) : null,
  )
  return useMemo(
    () =>
      server.data
        ? ratesFrom(server.data, offset === 0 ? "rate" : "prev")
        : local,
    [local, server.data, offset],
  )
}
export function lifeScoreOf(
  rates: Record<ModuleKey, number>,
  weights: Record<ModuleKey, number>,
  enabled: Record<ModuleKey, boolean>,
  rated?: Record<ModuleKey, boolean>,
): number | null {
  let num = 0
  let den = 0
  for (const k of MODULE_KEYS) {
    if (!enabled[k] || weights[k] <= 0 || rated?.[k] === false) continue
    num += weights[k] * clamp01(rates[k])
    den += weights[k]
  }
  return den ? Math.round((num / den) * 100) : null
}
export interface LifeScore {
  score: number | null
  prev: number | null
  delta: number | null
  rates: Record<ModuleKey, number>
  prevRates: Record<ModuleKey, number>
  /** Where the numbers came from; ``status`` tells loading/empty/error. */
  source?: "server" | "local"
  status?: ReturnType<typeof useServerStat>["status"]
}
export function useLifeScore(days: number): LifeScore {
  const cur = useAreaRates(days)
  const prevRates = useAreaRates(days, days)
  const rated = useLocalRates(days, 0).rated
  const prevRated = useLocalRates(days, days).rated
  const weights = useWeights()
  const enabled = useEnabled()
  const server = useServerStat<ServerOverview>(overviewKey(days))
  return useMemo(() => {
    const o = server.data
    if (o)
      return {
        score: o.life_score,
        prev: o.prev_score,
        delta: o.delta,
        rates: ratesFrom(o, "rate"),
        prevRates: ratesFrom(o, "prev"),
        source: "server" as const,
        status: server.status,
      }
    const score = lifeScoreOf(cur, weights, enabled, rated)
    const prev = lifeScoreOf(prevRates, weights, enabled, prevRated)
    return {
      score,
      prev,
      delta: score !== null && prev !== null ? score - prev : null,
      rates: cur,
      prevRates,
      source: "local" as const,
      status: server.status,
    }
  }, [
    cur,
    prevRates,
    rated,
    prevRated,
    weights,
    enabled,
    server.data,
    server.status,
  ])
}
export function levelFor(score: number | null) {
  if (score === null) return { name: "Not scored yet", next: null, floor: 0 }
  const levels = [
    { name: "Getting started", floor: 0 },
    { name: "Building", floor: 40 },
    { name: "Steady", floor: 55 },
    { name: "Strong", floor: 65 },
    { name: "Excellent", floor: 75 },
    { name: "Peak", floor: 85 },
  ]
  let i = 0
  while (i + 1 < levels.length && score >= levels[i + 1].floor) i++
  return {
    name: levels[i].name,
    floor: levels[i].floor,
    next: levels[i + 1] ?? null,
  }
}
export interface DayResult {
  day: string
  due: number
  done: number
  onTarget: boolean | null
}
export function useDaySeries(days: number): DayResult[] {
  const from = dayOffset(-(days - 1))
  const to = dayKey()
  const hc = HAB.useCalendar(from, to)
  const tc = TSK.useCalendar(from, to)
  const enabled = useEnabled()
  const threshold = dashStore.use((s) => s.targetThreshold)
  const wrapups = dashStore.use((s) => s.wrapups)
  return useMemo(() => {
    const map = new Map<
      string,
      {
        due: number
        done: number
      }
    >()
    const add = (items: CalendarItem[]) => {
      for (const i of items) {
        const d = map.get(i.day) ?? { due: 0, done: 0 }
        d.due++
        if (i.done) d.done++
        map.set(i.day, d)
      }
    }
    if (enabled.habits) add(hc)
    if (enabled.tasks) add(tc)
    const out: DayResult[] = []
    for (let i = days - 1; i >= 0; i--) {
      const day = dayOffset(-i)
      const d = map.get(day) ?? { due: 0, done: 0 }
      let onTarget: boolean | null = null
      if (d.due > 0) {
        const hit = d.done / d.due >= threshold
        onTarget = i === 0 ? (hit ? true : wrapups[day] ? false : null) : hit
      }
      out.push({ day, ...d, onTarget })
    }
    return out
  }, [hc, tc, enabled, threshold, wrapups, days])
}
export function onTargetStats(series: DayResult[]) {
  const scored = series.filter((d) => d.onTarget !== null)
  const onTarget = scored.filter((d) => d.onTarget).length
  let current = 0
  for (let i = series.length - 1; i >= 0; i--) {
    const w = series[i].onTarget
    if (w === null) continue
    if (!w) break
    current++
  }
  let best = 0
  let run = 0
  for (const d of series) {
    if (d.onTarget === null) continue
    run = d.onTarget ? run + 1 : 0
    best = Math.max(best, run)
  }
  return {
    rate: scored.length ? onTarget / scored.length : null,
    onTarget,
    scored: scored.length,
    current,
    best,
  }
}
export function useOnTarget(days: number) {
  const len = Math.max(days * 2, 365)
  const local = useDaySeries(len)
  const server = useServerStat<ServerOverview>(overviewKey(days))
  return useMemo(() => {
    const o = server.data
    // Live mode: the server's days overwrite the local ones they cover, so
    // the long series (heatmaps, achievements) keeps its length.
    const series = o ? overlayDays(local, seriesFrom(o)) : local
    if (o) {
      const t = o.on_target
      return {
        series,
        range: seriesFrom(o),
        rate: t.rate,
        prevRate: t.prev_rate,
        onTarget: t.on_target,
        scored: t.scored,
        current: t.current,
        best: t.best,
        logged: t.logged,
        source: "server" as const,
        status: server.status,
      }
    }
    const cur = series.slice(-days)
    const prev = series.slice(-days * 2, -days)
    const all = onTargetStats(series)
    const c = onTargetStats(cur)
    const p = onTargetStats(prev)
    return {
      series,
      range: cur,
      rate: c.rate,
      prevRate: p.rate,
      onTarget: c.onTarget,
      scored: c.scored,
      current: all.current,
      best: all.best,
      logged: series.filter((d) => d.done > 0).length,
      source: "local" as const,
      status: server.status,
    }
  }, [local, days, server.data, server.status])
}
/** ``base`` with each day ``over`` covers replaced by ``over``'s. */
export function overlayDays(base: DayResult[], over: DayResult[]): DayResult[] {
  if (!over.length) return base
  const byDay = new Map(over.map((d) => [d.day, d]))
  return base.map((d) => byDay.get(d.day) ?? d)
}
export function useTodayRing() {
  const h = HAB.useTodayProgress()
  const t = TSK.useTodayProgress()
  const f = FIT.useTodayProgress()
  const n = NUT.useTodayProgress()
  const fo = FOC.useTodayProgress()
  const fi = FIN.useTodayProgress()
  const sc = SCR.useTodayProgress()
  const enabled = useEnabled()
  const server = useServerStat<ServerToday>(statKey.today())
  return useMemo(() => {
    if (server.data) return ringFrom(server.data.ring)
    const per = {
      habits: h,
      tasks: t,
      fitness: f,
      nutrition: n,
      focus: fo,
      finance: fi,
      screen: sc,
    }
    let due = 0
    let done = 0
    for (const k of MODULE_KEYS)
      if (enabled[k]) {
        due += per[k].due
        done += Math.min(per[k].done, per[k].due)
      }
    return { due, done, per }
  }, [h, t, f, n, fo, fi, sc, enabled, server.data])
}
export function useAllCalendar(from: string, to: string): CalendarItem[] {
  const a = HAB.useCalendar(from, to)
  const b = TSK.useCalendar(from, to)
  const c = FIT.useCalendar(from, to)
  const fo = FOC.useCalendar(from, to)
  const d = FIN.useCalendar(from, to)
  const sc = SCR.useCalendar(from, to)
  const enabled = useEnabled()
  const server = useServerStat<ServerCalendarItem[]>(statKey.calendar(from, to))
  return useMemo(
    () =>
      (server.data
        ? calendarFrom(server.data)
        : [...a, ...b, ...c, ...fo, ...d, ...sc].filter(
            (i) => enabled[i.module],
          )
      ).sort(
        (x, y) =>
          x.day.localeCompare(y.day) ||
          (x.time ?? "99:99").localeCompare(y.time ?? "99:99"),
      ),
    [a, b, c, fo, d, sc, enabled, server.data],
  )
}
/** Today's (or any range's) items from this phone's own stores only, so
 * what was just checked off shows at once (``useAllCalendar`` prefers the
 * server's copy once it has one). */
export function useLocalCalendar(from: string, to: string): CalendarItem[] {
  const a = HAB.useCalendar(from, to)
  const b = TSK.useCalendar(from, to)
  const c = FIT.useCalendar(from, to)
  const d = FIN.useCalendar(from, to)
  const enabled = useEnabled()
  return useMemo(
    () =>
      [...a, ...b, ...c, ...d]
        .filter((i) => enabled[i.module])
        .sort(
          (x, y) =>
            x.day.localeCompare(y.day) ||
            (x.time ?? "99:99").localeCompare(y.time ?? "99:99"),
        ),
    [a, b, c, d, enabled],
  )
}
export function useAllMisses(from: string, to: string): Miss[] {
  const a = HAB.useMisses(from, to)
  const b = TSK.useMisses(from, to)
  const c = FIT.useMisses(from, to)
  const n = NUT.useMisses(from, to)
  const fo = FOC.useMisses(from, to)
  const d = FIN.useMisses(from, to)
  const sc = SCR.useMisses(from, to)
  const enabled = useEnabled()
  const server = useServerStat<ServerMiss[]>(statKey.misses(from, to))
  return useMemo(
    () =>
      (server.data
        ? missesFrom(server.data)
        : [...a, ...b, ...c, ...n, ...fo, ...d, ...sc].filter(
            (m) => enabled[m.module],
          )
      ).sort((x, y) => y.day.localeCompare(x.day)),
    [a, b, c, n, fo, d, sc, enabled, server.data],
  )
}
export function useAllMetrics(days: number): Record<ModuleKey, Metric[]> {
  const a = HAB.useMetrics(days)
  const b = TSK.useMetrics(days)
  const c = FIT.useMetrics(days)
  const n = NUT.useMetrics(days)
  const fo = FOC.useMetrics(days)
  const d = FIN.useMetrics(days)
  const sc = SCR.useMetrics(days)
  const server = useServerStat<ServerOverview>(overviewKey(days))
  return useMemo(
    () =>
      server.data
        ? metricsFrom(server.data)
        : {
            habits: a,
            tasks: b,
            fitness: c,
            nutrition: n,
            focus: fo,
            finance: d,
            screen: sc,
          },
    [a, b, c, n, fo, d, sc, server.data],
  )
}
export function parseMetric(value: string): number | null {
  if (/\d\s*\/\s*\d/.test(value) || /\d+h|\d+m\b/.test(value)) return null
  const m = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : null
}
export const unitOf = (value: string) =>
  value.includes("%") ? "%" : value.includes("kg") ? " kg" : ""
export interface BookEntry {
  ref: MetricRef
  label: string
  module: ModuleKey | "life"
  value: string
  n: number | null
  unit: string
  goodWhen: "up" | "down"
  shareable: boolean
  delta?: number
}
function book(
  metrics: Record<ModuleKey, Metric[]>,
  life: number | null,
  target: number | null,
  enabled: Record<ModuleKey, boolean>,
): Map<MetricRef, BookEntry> {
  const out = new Map<MetricRef, BookEntry>()
  out.set("life", {
    ref: "life",
    label: "Life Score",
    module: "life",
    value: life === null ? "—" : String(life),
    n: life,
    unit: "",
    goodWhen: "up",
    shareable: true,
  })
  out.set("onTarget", {
    ref: "onTarget",
    label: "On-target rate",
    module: "life",
    value: target === null ? "—" : `${Math.round(target * 100)}%`,
    n: target === null ? null : Math.round(target * 100),
    unit: "%",
    goodWhen: "up",
    shareable: true,
  })
  for (const k of MODULE_KEYS) {
    if (!enabled[k]) continue
    for (const m of metrics[k])
      out.set(`${k}:${m.key}`, {
        ref: `${k}:${m.key}`,
        label: m.label,
        module: k,
        value: m.value,
        n: parseMetric(m.value),
        unit: unitOf(m.value),
        goodWhen: m.goodWhen ?? "up",
        shareable: m.shareable,
        delta: m.delta,
      })
  }
  return out
}
export function useMetricBook() {
  const w = useAllMetrics(7)
  const m = useAllMetrics(30)
  const lw = useLifeScore(7)
  const lm = useLifeScore(30)
  const ww = useOnTarget(7)
  const wm = useOnTarget(30)
  const enabled = useEnabled()
  return useMemo(
    () => ({
      week: book(w, lw.score, ww.rate, enabled),
      month: book(m, lm.score, wm.rate, enabled),
    }),
    [w, m, lw.score, lm.score, ww.rate, wm.rate, enabled],
  )
}
export function goalProgress(g: Goal, current: number | null) {
  if (current === null) return { pct: 0, hit: false, current }
  if (g.comparator === "gte")
    return {
      pct: g.target ? current / g.target : 1,
      hit: current >= g.target,
      current,
    }
  return {
    pct: current <= g.target ? 1 : g.target / Math.max(current, 0.0001),
    hit: current <= g.target,
    current,
  }
}
const FIXED_LABEL: Record<string, string> = {
  life: "Life Score",
  onTarget: "On-target rate",
}
export function useGoals() {
  const goals = dashStore.use((s) => s.goals)
  const b = useMetricBook()
  const all = useAllMetrics(30)
  return useMemo(
    () =>
      goals.map((g) => {
        const entry = (g.period === "week" ? b.week : b.month).get(g.metric)
        const [mod, key] = g.metric.split(":") as [ModuleKey, string?]
        const label =
          entry?.label ??
          FIXED_LABEL[g.metric] ??
          (key ? all[mod]?.find((m) => m.key === key)?.label : undefined) ??
          g.label
        const goal = label === g.label ? g : { ...g, label }
        return { goal, entry, ...goalProgress(g, entry?.n ?? null) }
      }),
    [goals, b, all],
  )
}
export const fmtGoal = (g: Goal) =>
  `${g.comparator === "gte" ? "≥" : "≤"} ${g.target}${g.unit} / ${g.period}`
export const areaLabel = (k: ModuleKey | "life") =>
  k === "life" ? "Life" : AREA[k].label
export type TrophyType = "pr" | "streak" | "best" | "goal" | "first"
export interface Trophy {
  id: string
  type: TrophyType
  title: string
  value: string
  detail: string
  day: string
  href: string
  shareRef?: string
}
export const TROPHY_LABEL: Record<TrophyType, string> = {
  pr: "Personal records",
  streak: "Streak milestones",
  best: "Personal bests",
  goal: "Goals hit",
  first: "Firsts",
}
export interface Achievement {
  id: string
  type: TrophyType
  title: string
  requirement: string
  progress: {
    pct: number
    text: string
  }
  trophy: Trophy | null
}
const STREAK_MILESTONES = [7, 30, 100, 365]
const TROPHY_TYPES: TrophyType[] = ["pr", "streak", "best", "goal", "first"]
const trophyType = (t: string): TrophyType =>
  TROPHY_TYPES.includes(t as TrophyType) ? (t as TrophyType) : "first"
function trophyFrom(t: ServerAchievements["trophies"][number]): Trophy {
  const out: Trophy = {
    id: t.id,
    type: trophyType(t.type),
    title: t.title,
    value: t.value,
    detail: t.detail,
    day: t.day,
    href: t.href,
  }
  if (t.share_ref) out.shareRef = t.share_ref
  return out
}
export function achievementsFrom(r: ServerAchievements): Achievement[] {
  return r.data.map((a) => ({
    id: a.id,
    type: trophyType(a.type),
    title: a.title,
    requirement: a.requirement,
    progress: { pct: a.pct, text: a.text },
    trophy: a.trophy ? trophyFrom(a.trophy) : null,
  }))
}
export function useAchievements(): Achievement[] {
  const local = useLocalAchievements()
  const server = useServerStat<ServerAchievements>(statKey.achievements())
  return useMemo(
    () => (server.data ? achievementsFrom(server.data) : local),
    [local, server.data],
  )
}
function useLocalAchievements(): Achievement[] {
  const target = useOnTarget(365)
  const m30 = useAllMetrics(30)
  const m90 = useAllMetrics(90)
  const goals = useGoals()
  const wrapups = dashStore.use((s) => s.wrapups)
  const enabled = useEnabled()
  return useMemo(() => {
    const out: Achievement[] = []
    const prog = (cur: number, max: number, unit: string) => ({
      pct: max ? Math.max(0, Math.min(1, cur / max)) : 0,
      text: `${Math.min(cur, max)} / ${max} ${unit}`,
    })
    const s = target.series
    if (enabled.fitness) {
      const prs = (list: typeof m30) =>
        parseMetric(list.fitness.find((m) => m.key === "prs")?.value ?? "0") ??
        0
      const p30 = prs(m30)
      const p90 = prs(m90)
      const pr = (
        id: string,
        title: string,
        requirement: string,
        cur: number,
        max: number,
        detail: string,
        day: string,
      ) =>
        out.push({
          id,
          type: "pr",
          title,
          requirement,
          progress: prog(cur, max, max === 1 ? "PR" : "PRs"),
          trophy:
            cur >= max
              ? {
                  id,
                  type: "pr",
                  title,
                  value: String(cur),
                  detail,
                  day,
                  href: "/fitness/stats",
                }
              : null,
        })
      pr(
        "pr-30",
        "PR this month",
        "Set a new best lift (est. 1-rep max) in the last 30 days",
        p30,
        1,
        `${p30} new best lift${p30 === 1 ? "" : "s"} in 30 days`,
        dayOffset(-1),
      )
      pr(
        "pr-90-5",
        "5 PRs in 90 days",
        "Set 5 new best lifts within 90 days",
        p90,
        5,
        `${p90} new best lifts in 90 days`,
        dayOffset(-1),
      )
      pr(
        "pr-90-10",
        "10 PRs in 90 days",
        "Set 10 new best lifts within 90 days",
        p90,
        10,
        `${p90} new best lifts in 90 days`,
        dayOffset(-1),
      )
    }
    const hitDay = new Map<number, string>()
    let run = 0
    for (const d of s) {
      if (d.onTarget === null) continue
      run = d.onTarget ? run + 1 : 0
      if (STREAK_MILESTONES.includes(run)) hitDay.set(run, d.day)
    }
    for (const n of STREAK_MILESTONES) {
      const day = hitDay.get(n)
      out.push({
        id: `streak-${n}`,
        type: "streak",
        title: `${n}-day on-target streak`,
        requirement: `Hit your daily target ${n} days in a row`,
        progress: prog(target.current, n, "days"),
        trophy: day
          ? {
              id: `streak-${n}-${day}`,
              type: "streak",
              title: `${n}-day on-target streak`,
              value: `${n}d`,
              detail: `${n} on-target days in a row`,
              day,
              href: "/stats",
              shareRef: "streak",
            }
          : null,
      })
    }
    const hs = enabled.habits
      ? m90.habits.find((m) => m.key === "habits.streak")
      : undefined
    if (enabled.habits) {
      const top = parseMetric(hs?.value ?? "0") ?? 0
      const who = hs?.label.replace(/^Top streak( · )?/, "") ?? ""
      for (const n of STREAK_MILESTONES)
        out.push({
          id: `habit-streak-${n}`,
          type: "streak",
          title: `${n}-day habit streak`,
          requirement: `Reach a ${n}-day streak on any habit`,
          progress: prog(top, n, "days"),
          trophy:
            top >= n
              ? {
                  id: `habit-streak-${n}`,
                  type: "streak",
                  title: who
                    ? `${n}-day streak · ${who}`
                    : `${n}-day habit streak`,
                  value: `${n}d`,
                  detail: `Current top habit streak: ${top} days`,
                  day: dayOffset(-(top - n)),
                  href: "/habits",
                  shareRef: "streak",
                }
              : null,
        })
    }
    const bestWindow = (n: number) => {
      let best = { onTarget: 0, end: "" }
      for (let i = n; i <= s.length; i++) {
        const w = s.slice(i - n, i)
        const onTarget = w.filter((d) => d.onTarget).length
        if (onTarget > best.onTarget)
          best = { onTarget, end: w[w.length - 1].day }
      }
      return best
    }
    const bw = bestWindow(7)
    const bm = bestWindow(30)
    const best = (
      id: string,
      title: string,
      requirement: string,
      w: typeof bw,
      n: number,
      max: number,
      shareRef: ShareTemplate,
    ) =>
      out.push({
        id,
        type: "best",
        title,
        requirement,
        progress: prog(w.onTarget, max, "days"),
        trophy:
          w.onTarget >= max
            ? {
                id: `${id}-${w.end}`,
                type: "best",
                title,
                value: `${w.onTarget}/${n}`,
                detail: `${w.onTarget} on-target days in ${n}`,
                day: w.end,
                href: "/stats",
                shareRef,
              }
            : null,
      })
    best("best-week", "Best week", "Have an on-target day", bw, 7, 1, "weekly")
    best(
      "best-month",
      "Best month",
      "Have an on-target day",
      bm,
      30,
      1,
      "monthly",
    )
    best(
      "perfect-week",
      "Perfect week",
      "Hit your daily target on all 7 days of a week",
      bw,
      7,
      7,
      "weekly",
    )
    best(
      "perfect-month",
      "Perfect month",
      "Hit your daily target on all 30 days of a month",
      bm,
      30,
      30,
      "monthly",
    )
    const active = goals.filter((g) => g.goal.status === "active")
    for (const g of active) {
      const title = `${g.goal.label} ${fmtGoal(g.goal)}`
      out.push({
        id: `goal-${g.goal.id}`,
        type: "goal",
        title,
        requirement: `Reach ${g.goal.comparator === "gte" ? "at least" : "at most"} ${g.goal.target}${g.goal.unit} this ${g.goal.period}`,
        progress: {
          pct: Math.max(0, Math.min(1, g.pct)),
          text: `${g.entry?.value ?? "—"} / ${g.goal.target}${g.goal.unit}`,
        },
        trophy:
          g.hit && g.entry
            ? {
                id: `goal-${g.goal.id}`,
                type: "goal",
                title,
                value: g.entry.value,
                detail: `Target ${g.goal.target}${g.goal.unit}`,
                day: dayKey(),
                href: "/stats/goals",
                shareRef: "goal",
              }
            : null,
      })
    }
    const hits = active.filter((g) => g.hit).length
    out.push({
      id: "goal-hat-trick",
      type: "goal",
      title: "Hat trick",
      requirement: "Hit 3 goals at the same time",
      progress: prog(hits, 3, "goals"),
      trophy:
        hits >= 3
          ? {
              id: "goal-hat-trick",
              type: "goal",
              title: "Hat trick",
              value: String(hits),
              detail: `${hits} goals hit at once`,
              day: dayKey(),
              href: "/stats/goals",
              shareRef: "goal",
            }
          : null,
    })
    const first = (
      id: string,
      title: string,
      requirement: string,
      day: string | undefined,
      detail: string,
      href: string,
    ) =>
      out.push({
        id,
        type: "first",
        title,
        requirement,
        progress: prog(day ? 1 : 0, 1, ""),
        trophy: day
          ? {
              id: `${id}-${day}`,
              type: "first",
              title,
              value: "1st",
              detail,
              day,
              href,
            }
          : null,
      })
    first(
      "first-on-target",
      "First on-target day",
      "Hit your daily target once",
      s.find((d) => d.onTarget)?.day,
      "Where the streaks began",
      "/stats",
    )
    first(
      "first-wrap",
      "First day wrapped up",
      "Seal a day with an evening wrap-up",
      Object.keys(wrapups).sort()[0],
      "Sealed a day with a reflection",
      "/today/wrap-up",
    )
    first(
      "first-goal",
      "First goal set",
      "Set a goal on any metric",
      goals.map((g) => g.goal.createdAt).sort()[0],
      "Put a number on it",
      "/stats/goals",
    )
    for (const a of out) a.progress.text = a.progress.text.trim()
    return out
  }, [target.series, target.current, m30, m90, goals, wrapups, enabled])
}
export function useTrophies(): Trophy[] {
  const all = useAchievements()
  const server = useServerStat<ServerAchievements>(statKey.achievements())
  return useMemo(
    () =>
      server.data
        ? server.data.trophies.map(trophyFrom)
        : all
            .flatMap((a) => (a.trophy ? [a.trophy] : []))
            .sort((a, b) => b.day.localeCompare(a.day)),
    [all, server.data],
  )
}
function bookEntryFrom(e: NonNullable<ServerMetricDetail["week"]>): BookEntry {
  const out: BookEntry = {
    ref: e.ref,
    label: e.label,
    module: e.module as BookEntry["module"],
    value: e.value,
    n: e.n,
    unit: e.unit,
    goodWhen: e.good_when,
    shareable: e.shareable,
  }
  if (e.delta !== null) out.delta = e.delta
  return out
}
/** One metric this week and this month (``/stats/metrics/{ref}``). */
export function useMetricDetail(ref: MetricRef): {
  week: BookEntry | undefined
  month: BookEntry | undefined
} {
  const b = useMetricBook()
  const server = useServerStat<ServerMetricDetail>(statKey.metric(ref))
  return useMemo(() => {
    const d = server.data
    if (d)
      return {
        week: d.week ? bookEntryFrom(d.week) : undefined,
        month: d.month ? bookEntryFrom(d.month) : undefined,
      }
    return { week: b.week.get(ref), month: b.month.get(ref) }
  }, [b, ref, server.data])
}
export type RangeKey = "7d" | "30d" | "90d" | "1y"
export const RANGES: {
  value: RangeKey
  label: string
  days: number
}[] = [
  { value: "7d", label: "7d", days: 7 },
  { value: "30d", label: "30d", days: 30 },
  { value: "90d", label: "90d", days: 90 },
  { value: "1y", label: "1y", days: 365 },
]
export const daysOf = (r: RangeKey) =>
  RANGES.find((x) => x.value === r)?.days ?? 7
