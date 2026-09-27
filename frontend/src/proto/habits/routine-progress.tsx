"use client"

import { ChevronRight, Gauge, TrendingDown } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { dayKey, dayOffset } from "../lib/day"
import { Card, Ring } from "../ui/kit"
import type { Habit, Routine } from "./data"
import { daysBetween, pct, type routineStats, runState, slotFor } from "./logic"
import { HabitIcon } from "./ui"

type Stats = ReturnType<typeof routineStats>
type DayMark = "done" | "abandoned" | "missed" | "off" | "today"

const STRIP_DAYS = 14

/** One routine's progress: completion ring, outcome split, 14-day strip,
 *  pace vs plan, and the step where abandoned runs usually stop. */
export function RoutineProgressCard({
  r,
  s,
  habits,
}: {
  r: Routine
  s: Stats
  habits: Habit[]
}) {
  const today = dayKey()
  const missed = Math.max(0, s.scheduledDays - s.completed - s.abandoned.length)
  const total = Math.max(1, s.completed + s.abandoned.length + missed)

  // last 14 days, oldest first
  const strip: { day: string; mark: DayMark }[] = daysBetween(
    dayOffset(-(STRIP_DAYS - 1)),
    today,
  ).map((day) => {
    const run = s.runs.find((x) => x.day === day)
    const state = run ? runState(run, today) : null
    if (state === "completed") return { day, mark: "done" }
    if (state === "abandoned") return { day, mark: "abandoned" }
    if (day < r.createdAt || !slotFor(r.schedule, day))
      return { day, mark: "off" }
    return { day, mark: day === today ? "today" : "missed" }
  })

  // where abandoned runs stop: first step that wasn't done
  const stops = new Map<number, number>()
  for (const run of s.abandoned) {
    const i = run.results.findIndex((x) => x.status !== "done")
    const at = i === -1 ? run.results.length : i
    stops.set(at, (stops.get(at) ?? 0) + 1)
  }
  const [dropIdx, dropN] =
    [...stops.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const dropStep = dropIdx !== undefined ? r.steps[dropIdx] : undefined
  const dropName = dropStep
    ? (habits.find((h) => h.id === dropStep.habitId)?.name ?? "a step")
    : undefined

  const plannedMin = r.steps.reduce((a, x) => a + x.minutes, 0)
  const paceDelta = s.pace ? Math.round((s.pace - 1) * 100) : null
  const time = r.schedule[0]?.time

  const segs = [
    { n: s.completed, label: "done", cls: "bg-hab" },
    { n: s.abandoned.length, label: "abandoned", cls: "bg-warn" },
    { n: missed, label: "missed", cls: "bg-muted-foreground/40" },
  ]

  return (
    <Card className="p-0">
      <Link
        href={`/habits/routines/${r.id}`}
        className="block rounded-2xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/40"
      >
        <div className="flex items-center gap-3">
          <HabitIcon icon={r.icon} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{r.name}</div>
            <div className="text-muted-foreground text-xs">
              {r.steps.length} steps · {plannedMin}m planned
              {time ? ` · ${time}` : ""}
            </div>
          </div>
          <Ring value={s.rate} size={52} stroke={6} accent="hab">
            <span className="num font-semibold text-xs">{pct(s.rate)}</span>
          </Ring>
          <ChevronRight
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
        </div>

        {/* outcome split — counts are always written out, not colour-only */}
        <div
          className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`${s.completed} done, ${s.abandoned.length} abandoned, ${missed} missed`}
        >
          {segs.map((g) =>
            g.n ? (
              <div
                key={g.label}
                className={g.cls}
                style={{ width: `${(g.n / total) * 100}%` }}
              />
            ) : null,
          )}
        </div>
        <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
          {segs.map((g) => (
            <span key={g.label} className="flex items-center gap-1">
              <span
                className={cn("size-2 rounded-full", g.cls)}
                aria-hidden="true"
              />
              <span className="num font-medium text-foreground">{g.n}</span>{" "}
              {g.label}
            </span>
          ))}
        </div>

        {/* last 14 days */}
        <div className="mt-3">
          <div className="mb-1 text-[10px] text-muted-foreground uppercase tracking-wider">
            Last 2 weeks
          </div>
          <div
            className="flex gap-1"
            role="img"
            aria-label={`Last ${STRIP_DAYS} days: ${strip.filter((x) => x.mark === "done").length} completed, ${strip.filter((x) => x.mark === "abandoned").length} abandoned, ${strip.filter((x) => x.mark === "missed").length} missed`}
          >
            {strip.map(({ day, mark }) => (
              <span
                key={day}
                title={`${day}: ${mark}`}
                className={cn(
                  "h-5 flex-1 rounded-[4px]",
                  mark === "done" && "bg-hab",
                  mark === "abandoned" && "bg-warn/80",
                  mark === "missed" && "border border-muted-foreground/40",
                  mark === "off" && "bg-muted/40",
                  mark === "today" && "border border-hab border-dashed",
                )}
              />
            ))}
          </div>
        </div>

        {/* insights */}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-2">
            <Gauge className="size-4 shrink-0 text-hab" aria-hidden="true" />
            <span>
              {paceDelta === null ? (
                "No finished runs yet"
              ) : paceDelta === 0 ? (
                "On plan"
              ) : (
                <>
                  <b className="num">{Math.abs(paceDelta)}%</b>{" "}
                  {paceDelta < 0 ? "faster than plan" : "over plan"}
                </>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-2">
            <TrendingDown
              className="size-4 shrink-0 text-warn"
              aria-hidden="true"
            />
            <span className="min-w-0">
              {dropName ? (
                <>
                  Stops at <b>{dropName}</b> ({dropN}×)
                </>
              ) : (
                "No drop-offs"
              )}
            </span>
          </div>
        </div>
      </Link>
    </Card>
  )
}
