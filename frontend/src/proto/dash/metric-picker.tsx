"use client"

import { Check, ChevronRight, Search, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "../contract"
import { MODULE_KEYS } from "./data"
import { type Facet, useFacets } from "./hexagon"
import {
  type BookEntry,
  useAllMetrics,
  useEnabled,
  useMetricBook,
} from "./hooks"
import { BottomSheet } from "./ui"

// One searchable, grouped metric list — used by the goal editor's metric picker
// and by Stats → "All metrics". Groups follow the area-hexagon facet split.

export interface MetricItem {
  ref: string
  label: string
  value: string
  module: ModuleKey | "life"
  group: string
  href?: string
}

/** Plain-English, factual one-liners keyed by metric ref. */
export const METRIC_DESC: Record<string, string> = {
  life: "Weighted blend of your area scores, 0–100.",
  onTarget: "Share of logged days where you hit your daily targets.",
  "habits:habits.rate": "Share of scheduled habit check-ins you completed.",
  "habits:habits.streak": "Current run of consecutive days for your top habit.",
  "habits:habits.perfect": "Days where every scheduled habit got done.",
  "habits:habits.time": "Total time logged on timed habits.",
  "habits:habits.skip": "Share of scheduled habits you marked as skipped.",
  "habits:routines.rate":
    "Share of scheduled routines completed (closed days).",
  "habits:routines.runs": "Routine runs you finished from start to end.",
  "habits:routines.avg":
    "Average time from starting a routine run to finishing.",
  "tasks:tasks.done": "Tasks marked done in the period.",
  "tasks:tasks.onTime": "Share of done tasks with a due date finished on time.",
  "tasks:tasks.streak": "Consecutive days with at least one task done.",
  "tasks:tasks.overdue": "Open tasks past their due date right now.",
  "tasks:tasks.reschedules": "Times a task's date was moved in the period.",
  "tasks:tasks.followThrough":
    "On-time finishes (late ones count half) per overdue or moved task.",
  "fitness:sessions": "Workouts logged in the period.",
  "fitness:prs": "New personal records set in the period.",
  "fitness:volume": "Total weight × reps lifted across all sets.",
  "fitness:overload": "Share of trained lifts whose estimated 1RM went up.",
  "fitness:protein": "Share of logged days you hit your protein target.",
  "fitness:calories": "Share of logged days within your calorie target.",
  "fitness:weight": "Average of your weigh-ins over the last 7 days.",
  "finance:savings-rate": "Share of income left after spending.",
  "finance:no-spend": "Days with no spending recorded.",
  "finance:budgets": "Budgets still at or under their limit.",
  "finance:runway": "Months your balance would cover typical spending.",
  "finance:spend-vs": "Change in spending compared with the previous period.",
}

const GROUP_TEXT: Record<ModuleKey | "life", string> = {
  life: "text-life",
  habits: "text-hab",
  tasks: "text-tsk",
  fitness: "text-fit",
  finance: "text-fin",
}

/** Facet label for a module metric; falls back to the module's catch-all facet. */
function groupOf(module: ModuleKey, key: string, facets: Facet[]): string {
  const own = facets.filter((f) => f.module === module)
  const hit =
    own.find(
      (f) => f.metricKeys?.includes(key) || f.extra?.some((m) => m.key === key),
    ) ?? own.find((f) => !f.metricKeys)
  return hit?.label ?? module
}

const GROUP_ORDER = [
  "Overall",
  "Habits",
  "Routines",
  "Tasks",
  "Training",
  "Nutrition",
  "Finance",
]
const rank = (g: string) => {
  const i = GROUP_ORDER.indexOf(g)
  return i === -1 ? GROUP_ORDER.length : i
}

/** Goal-able metrics from the metric book (for the goal editor). */
export function useGoalMetricItems(period: "week" | "month"): MetricItem[] {
  const b = useMetricBook()
  const facets = useFacets(period === "week" ? 7 : 30)
  return useMemo(
    () =>
      [...(period === "week" ? b.week : b.month).values()]
        .filter((e: BookEntry) => e.n !== null)
        .map((e) => ({
          ref: e.ref,
          label: e.label,
          value: e.value,
          module: e.module,
          group:
            e.module === "life"
              ? "Overall"
              : groupOf(e.module, e.ref.split(":")[1] ?? "", facets),
        })),
    [b, period, facets],
  )
}

/** Every metric with a detail destination (for Stats → All metrics). */
export function useStatsMetricItems(days: number): MetricItem[] {
  const metrics = useAllMetrics(days)
  const facets = useFacets(days)
  const enabled = useEnabled()
  return useMemo(() => {
    const out: MetricItem[] = []
    for (const k of MODULE_KEYS) {
      if (!enabled[k]) continue
      for (const m of metrics[k])
        out.push({
          ref: `${k}:${m.key}`,
          label: m.label,
          value: m.value,
          module: k,
          group: groupOf(k, m.key, facets),
          href: `/stats/metric/${encodeURIComponent(`${k}:${m.key}`)}?range=${days}`,
        })
      for (const f of facets.filter((x) => x.module === k && x.extra))
        for (const m of f.extra ?? [])
          out.push({
            ref: `${k}:${m.key}`,
            label: m.label,
            value: m.value,
            module: k,
            group: f.label,
            href: f.href,
          })
    }
    return out
  }, [metrics, facets, days, enabled])
}

export function MetricList({
  items,
  selected,
  onPick,
}: {
  items: MetricItem[]
  selected?: string
  onPick: (item: MetricItem) => void
}) {
  const [q, setQ] = useState("")
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle
      ? items.filter((i) =>
          `${i.label} ${i.group} ${METRIC_DESC[i.ref] ?? ""}`
            .toLowerCase()
            .includes(needle),
        )
      : items
    const names = [...new Set(hit.map((i) => i.group))].sort(
      (a, b) => rank(a) - rank(b) || a.localeCompare(b),
    )
    return names.map((name) => ({
      name,
      list: hit.filter((i) => i.group === name),
    }))
  }, [items, q])

  return (
    <div>
      <div className="relative">
        <Search
          aria-hidden
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search metrics"
          aria-label="Search metrics"
          className="h-11 w-full rounded-xl border border-border bg-card pr-11 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQ("")}
            className="-translate-y-1/2 absolute top-1/2 right-0 grid size-11 place-items-center rounded-full text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {groups.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">
          No metric matches “{q}”.
        </p>
      ) : (
        groups.map((g) => (
          <section key={g.name} aria-label={g.name} className="mt-4">
            <h3 className="mb-1 px-1 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {g.name}
            </h3>
            <ul className="divide-y divide-border/50 rounded-2xl border border-border/60 bg-card">
              {g.list.map((i) => {
                const on = i.ref === selected
                return (
                  <li key={i.ref}>
                    <button
                      type="button"
                      aria-current={on || undefined}
                      onClick={() => onPick(i)}
                      className={cn(
                        "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted/60",
                        on && "bg-muted/60",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-sm">
                          {i.label}
                        </span>
                        {METRIC_DESC[i.ref] && (
                          <span className="block truncate text-muted-foreground text-xs">
                            {METRIC_DESC[i.ref]}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "num shrink-0 font-display font-semibold text-lg",
                          GROUP_TEXT[i.module],
                        )}
                      >
                        {i.value}
                      </span>
                      {on ? (
                        <Check className="size-4 shrink-0 text-primary" />
                      ) : i.href ? (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

export function MetricPickerSheet({
  open,
  onClose,
  title,
  items,
  selected,
  onPick,
}: {
  open: boolean
  onClose: () => void
  title: string
  items: MetricItem[]
  selected?: string
  onPick: (item: MetricItem) => void
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      description="Search or browse by area."
    >
      <MetricList
        items={items}
        selected={selected}
        onPick={(i) => {
          onPick(i)
          onClose()
        }}
      />
    </BottomSheet>
  )
}

/** Stats → All metrics: browse everything, tap to open the metric detail. */
export function AllMetricsSheet({
  open,
  onClose,
  days,
}: {
  open: boolean
  onClose: () => void
  days: number
}) {
  const items = useStatsMetricItems(days)
  const router = useRouter()
  return (
    <MetricPickerSheet
      open={open}
      onClose={onClose}
      title={`All metrics · ${days}d`}
      items={items}
      onPick={(i) => i.href && router.push(i.href)}
    />
  )
}
