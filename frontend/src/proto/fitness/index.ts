import { useMemo } from "react"
import type { CalendarItem, Metric, Miss, ModuleContract } from "../contract"
import { dayKey } from "../lib/day"
import {
  addDays,
  adherence,
  dailyWeights,
  exerciseHistory,
  finished,
  fmtVolume,
  isStalled,
  nutritionDays,
  overloadRate,
  periodSummary,
  sessionsByWeek,
  targetFor,
  weeklyRate,
  weekStart,
} from "./calc"
import { useFit } from "./store"
import { FitnessTodayCard } from "./today-card"

// M3 Fitness — ModuleContract implementation.

/** 0..1: mean of session adherence and (when logged) calorie adherence. */
function useAreaRate(days: number, offset = 0): number {
  const s = useFit()
  return useMemo(() => {
    const p = periodSummary(s, days, -offset)
    const a = adherence(s, days, offset)
    return a.logged ? (p.sessionRate + a.calorie) / 2 : p.sessionRate
  }, [s, days, offset])
}

function useMetrics(days: number): Metric[] {
  const s = useFit()
  return useMemo(() => {
    const cur = periodSummary(s, days)
    const prev = periodSummary(s, days, -days)
    const a = adherence(s, days)
    const rate = weeklyRate(s)
    return [
      {
        key: "sessions",
        label: "Workouts",
        value: String(cur.sessions),
        delta: cur.sessions - prev.sessions,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "prs",
        label: "PRs",
        value: String(cur.prs),
        delta: cur.prs - prev.prs,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "volume",
        label: "Volume lifted",
        value: fmtVolume(cur.volume),
        delta: Math.round(
          ((cur.volume - prev.volume) / Math.max(1, prev.volume)) * 100,
        ),
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "overload",
        label: "Progress rate",
        value: `${Math.round(overloadRate(s, Math.max(28, days)) * 100)}%`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "protein",
        label: "Protein hit rate",
        value: `${Math.round(a.protein * 100)}%`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "calories",
        label: "Calories on target",
        value: `${Math.round(a.calorie * 100)}%`,
        goodWhen: "up",
        shareable: true,
      },
      {
        key: "weight",
        label: "Weight (7-day avg)",
        value: rate ? `${rate.avg.toFixed(1)} kg` : "—",
        delta: rate ? Math.round(rate.kg * 100) / 100 : undefined,
        goodWhen: s.settings.goalDirection === "bulk" ? "up" : "down",
        shareable: false, // bodyweight only with opt-in
      },
    ]
  }, [s, days])
}

function useCalendar(from: string, to: string): CalendarItem[] {
  const s = useFit()
  return useMemo(
    () =>
      s.workouts
        .filter((w) => w.status !== "discarded")
        .map((w) => ({ w, day: dayKey(new Date(w.startedAt)) }))
        .filter(({ day }) => day >= from && day <= to)
        .map(({ w, day }) => ({
          id: `fit-${w.id}`,
          day,
          time: new Date(w.startedAt).toTimeString().slice(0, 5),
          title:
            w.status === "in_progress" ? `${w.name} (in progress)` : w.name,
          module: "fitness" as const,
          done: w.status === "finished",
          href:
            w.status === "finished"
              ? `/fitness/workouts/${w.id}`
              : "/fitness/workout",
        })),
    [s, from, to],
  )
}

function useMisses(from: string, to: string): Miss[] {
  const s = useFit()
  return useMemo(() => {
    const out: Miss[] = []
    const thisWeek = weekStart(dayKey())
    // Missed sessions per completed ISO week inside the range.
    for (const w of sessionsByWeek(s, 20)) {
      const end = addDays(w.start, 6)
      if (w.start < from || end > to || w.start >= thisWeek) continue
      const miss = s.settings.weeklyTarget - w.count
      if (miss > 0)
        out.push({
          id: `fit-miss-${w.start}`,
          day: end,
          title: `Missed ${miss} gym session${miss > 1 ? "s" : ""} (${w.count}/${s.settings.weeklyTarget})`,
          module: "fitness",
          href: "/fitness/stats",
        })
    }
    // Over-target calorie days.
    for (const d of nutritionDays(s, 90)) {
      if (
        d.day < from ||
        d.day > to ||
        d.day === dayKey() ||
        !d.over ||
        !d.target
      )
        continue
      out.push({
        id: `fit-over-${d.day}`,
        day: d.day,
        title: `Over calories by ${Math.round((d.totals.kcal / d.target.kcal - 1) * 100)}%`,
        module: "fitness",
        href: `/fitness/nutrition?day=${d.day}`,
      })
    }
    // Stalled lifts (reported today).
    const today = dayKey()
    if (today >= from && today <= to)
      for (const e of s.exercises)
        if (!e.archived && isStalled(exerciseHistory(s, e.id)))
          out.push({
            id: `fit-stall-${e.id}`,
            day: today,
            title: `Stalled: ${e.name} (no strength gain in 3 wks)`,
            module: "fitness",
            href: `/fitness/exercises/${e.id}`,
          })
    return out.sort((a, b) => b.day.localeCompare(a.day))
  }, [s, from, to])
}

/** Due today: weigh-in, protein target, and a workout while the weekly target isn't met. */
function useTodayProgress() {
  const s = useFit()
  return useMemo(() => {
    const today = dayKey()
    const trainedToday = finished(s).some(
      (w) => dayKey(new Date(w.startedAt)) === today,
    )
    const week = sessionsByWeek(s, 1)[0]?.count ?? 0
    const workoutDue = trainedToday || week < s.settings.weeklyTarget
    const target = targetFor(s, today)
    const nut = nutritionDays(s, 1)[0]
    const weighed = dailyWeights(s).has(today)
    let due = 1
    let done = weighed ? 1 : 0
    if (workoutDue) {
      due++
      if (trainedToday) done++
    }
    if (target) {
      due++
      if (nut?.proteinHit) done++
    }
    return { due, done }
  }, [s])
}

export const module: ModuleContract = {
  key: "fitness",
  label: "Fitness",
  TodayCard: FitnessTodayCard,
  useAreaRate,
  useMetrics,
  useCalendar,
  useMisses,
  useTodayProgress,
  href: "/fitness",
}
