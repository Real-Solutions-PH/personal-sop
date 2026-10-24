import { useMemo } from "react"
import type { Metric, ModuleKey } from "../contract"
import { adherence, periodSummary } from "../fitness/calc"
import { useFit } from "../fitness/store"
import { module as HAB } from "../habits"
import { habitsStore } from "../habits/store"
import { dayOffset } from "../lib/day"
import { useEnabled, useLifeScore } from "./hooks"
import {
  metricFrom,
  overviewKey,
  type ServerFacet,
  type ServerOverview,
  useServerStat,
} from "./server-stats"

const MODULE_KEYS: ModuleKey[] = [
  "habits",
  "tasks",
  "fitness",
  "nutrition",
  "focus",
  "finance",
]
export function facetsFrom(rows: ServerFacet[]): Facet[] {
  return rows.flatMap((r) => {
    const module = r.module as ModuleKey
    if (!MODULE_KEYS.includes(module)) return []
    const f: Facet = {
      key: r.key,
      label: r.label,
      module,
      value: r.value,
      prev: r.prev,
      off: r.off,
      href: r.href,
    }
    if (r.metric_keys) f.metricKeys = r.metric_keys
    if (r.extra.length) f.extra = r.extra.map(metricFrom)
    return [f]
  })
}

export interface Facet {
  key: string
  label: string
  module: ModuleKey
  value: number // 0..1, current period
  prev: number // 0..1, previous period of equal length
  off: boolean // module disabled
  /** Which of the module's metrics belong to this facet (undefined = all). */
  metricKeys?: string[]
  /** Facet-only metrics the module doesn't export (e.g. routines). */
  extra?: Metric[]
  href: string
}

export function useFacets(days: number): Facet[] {
  const local = useLocalFacets(days)
  const server = useServerStat<ServerOverview>(overviewKey(days))
  return useMemo(
    () => (server.data ? facetsFrom(server.data.facets) : local),
    [local, server.data],
  )
}
function useLocalFacets(days: number): Facet[] {
  const ls = useLifeScore(days)
  const enabled = useEnabled()
  const fit = useFit()
  const runs = habitsStore.use((st) => st.runs)
  // Routines: closed days only (today's routine may still be ahead).
  const cal = HAB.useCalendar(dayOffset(-days * 2), dayOffset(-1))
  return useMemo(() => {
    const split = dayOffset(-days)
    const rate = (items: typeof cal) =>
      items.length ? items.filter((i) => i.done).length / items.length : 0
    const routines = cal.filter((i) => i.id.startsWith("routine-"))
    const nut = (offset: number) => {
      const a = adherence(fit, days, offset)
      return a.logged ? (a.calorie + a.protein) / 2 : 0
    }
    const f = (
      key: string,
      label: string,
      module: ModuleKey,
      value: number,
      prev: number,
      href: string,
      more: Partial<Facet> = {},
    ): Facet => ({
      key,
      label,
      module,
      value,
      prev,
      href,
      off: !enabled[module],
      ...more,
    })
    const rCur = routines.filter((i) => i.day > split)
    const rPrev = routines.filter((i) => i.day <= split)
    const finished = (from: string, to: string) =>
      runs.filter(
        (r) => r.state === "completed" && r.day >= from && r.day <= to,
      )
    const fCur = finished(dayOffset(-(days - 1)), dayOffset(0))
    const fPrev = finished(dayOffset(-(days * 2 - 1)), split)
    const avgMin = (list: typeof runs) => {
      const done = list.filter((r) => r.endedAt)
      if (!done.length) return 0
      const ms = done.reduce(
        (sum, r) =>
          sum +
          new Date(r.endedAt as string).getTime() -
          new Date(r.startedAt).getTime(),
        0,
      )
      return Math.round(ms / done.length / 60_000)
    }
    const routineMetrics: Metric[] = [
      {
        key: "routines.rate",
        label: "Routines completed",
        value: `${Math.round(rate(rCur) * 100)}%`,
        delta: Math.round((rate(rCur) - rate(rPrev)) * 100),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "routines.runs",
        label: "Runs finished",
        value: String(fCur.length),
        delta: fCur.length - fPrev.length,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "routines.avg",
        label: "Avg run time",
        value: `${avgMin(fCur)}m`,
        shareable: true,
      },
    ]
    return [
      f(
        "habits",
        "Habits",
        "habits",
        ls.rates.habits,
        ls.prevRates.habits,
        "/habits",
      ),
      f(
        "routines",
        "Routines",
        "habits",
        rate(rCur),
        rate(rPrev),
        "/habits/routines",
        {
          metricKeys: [],
          extra: routineMetrics,
        },
      ),
      f(
        "tasks",
        "Tasks",
        "tasks",
        ls.rates.tasks,
        ls.prevRates.tasks,
        "/tasks/stats",
      ),
      f(
        "training",
        "Training",
        "fitness",
        periodSummary(fit, days).sessionRate,
        periodSummary(fit, days, -days).sessionRate,
        "/fitness",
        { metricKeys: ["sessions", "prs", "volume", "overload"] },
      ),
      f(
        "nutrition",
        "Nutrition",
        "nutrition",
        nut(0),
        nut(days),
        "/nutrition",
        {
          metricKeys: ["calories", "protein", "kcal", "logged"],
        },
      ),
      f(
        "focus",
        "Focus",
        "focus",
        ls.rates.focus,
        ls.prevRates.focus,
        "/focus/stats",
        {
          metricKeys: ["focused", "daily", "goalDays", "sessions", "pomodoros"],
        },
      ),
      f(
        "finance",
        "Finance",
        "finance",
        ls.rates.finance,
        ls.prevRates.finance,
        "/finance/reports",
      ),
    ]
  }, [ls, enabled, fit, cal, runs, days])
}
