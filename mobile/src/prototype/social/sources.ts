import * as D from "@domain/dash/hooks"
import { netWorth, netWorthSeries } from "@domain/finance/calc"
import { finStore } from "@domain/finance/store"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { logIndex, overallStats, streaks } from "@domain/habits/logic"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { useStats } from "@domain/tasks/hooks"
import { useMemo } from "react"
import type { Progress, Scorecard } from "./store"

const peso = (n: number) =>
  Math.abs(n) >= 1000
    ? `₱${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`
    : `₱${Math.round(n)}`

/**
 * Live progress attachments built from the user's own data, so a post or
 * story can carry a real workout, streak, score or savings card.
 */
export function useProgressSources(): Progress[] {
  const life = D.useLifeScore(30)
  const target = D.useOnTarget(30)
  const fit = fitStore.use((s) => s)
  const habits = habitsStore.use((s) => s)
  const fin = finStore.use((s) => s)
  const tasks = useStats(7)
  return useMemo(() => {
    const out: Progress[] = []
    if (life.score !== null)
      out.push({
        accent: "life",
        kind: "Life score",
        title: `${D.levelFor(life.score).name} · ${life.score}`,
        subtitle: "Last 30 days",
        stats: [
          { label: "Score", value: String(life.score) },
          {
            label: "vs prior",
            value: `${(life.delta ?? 0) >= 0 ? "+" : ""}${life.delta ?? 0}`,
          },
          { label: "Streak", value: String(target.current), unit: "days" },
        ],
        spark: target.series
          .slice(-30)
          .map((d) => (d.due ? d.done / d.due : 0)),
      })
    const w = C.finished(fit)[0]
    if (w) {
      const totals = C.workoutTotals(fit, w)
      const prs = C.allPrs(fit).filter((p) => p.workoutId === w.id)
      out.push({
        accent: "fit",
        kind: "Workout",
        title: w.name || "Workout",
        subtitle: prs.length
          ? `${prs.length} personal record${prs.length > 1 ? "s" : ""}`
          : C.relDay(w.startedAt),
        stats: [
          {
            label: "Time",
            value: String(Math.round(totals.durationSec / 60)),
            unit: "min",
          },
          { label: "Volume", value: C.fmtVolume(totals.volume) },
          { label: "Sets", value: String(totals.done) },
        ],
        spark: C.sessionsByWeek(fit, 8).map((x) => x.count),
      })
    }
    const idx = logIndex(habits.logs)
    const best = habits.habits
      .filter((h) => h.status !== "archived")
      .map((h) => ({ h, s: streaks(h, idx) }))
      .sort((a, b) => b.s.current - a.s.current)[0]
    if (best && best.s.current > 0) {
      const rate = overallStats(habits, 30).rate
      out.push({
        accent: "hab",
        kind: "Habit streak",
        title: best.h.name,
        subtitle: `${best.s.current}-day streak`,
        stats: [
          { label: "Streak", value: String(best.s.current), unit: "days" },
          { label: "Best", value: String(best.s.best), unit: "days" },
          {
            label: "30-day rate",
            value: String(Math.round(rate * 100)),
            unit: "%",
          },
        ],
      })
    }
    const day = C.dayTotals(fit, dayKey())
    if (day.totals.kcal > 0)
      out.push({
        accent: "nut",
        kind: "Nutrition",
        title: "Today's fuel",
        stats: [
          { label: "Calories", value: String(Math.round(day.totals.kcal)) },
          {
            label: "Protein",
            value: String(Math.round(day.totals.protein)),
            unit: "g",
          },
          {
            label: "Carbs",
            value: String(Math.round(day.totals.carbs)),
            unit: "g",
          },
        ],
      })
    out.push({
      accent: "tsk",
      kind: "Tasks",
      title: "This week",
      stats: [
        { label: "Done", value: String(tasks.done) },
        { label: "Streak", value: String(tasks.streak), unit: "days" },
      ],
    })
    const series = netWorthSeries(fin, 90)
    if (series.length > 1) {
      const nw = netWorth(fin)
      const change = nw - series[0]
      out.push({
        accent: "fin",
        kind: "Savings",
        title: change >= 0 ? `Up ${peso(change)} in 90 days` : "Net worth",
        stats: [
          { label: "Net worth", value: peso(nw) },
          {
            label: "90-day change",
            value: `${change >= 0 ? "+" : "−"}${peso(Math.abs(change))}`,
          },
        ],
        spark: series.filter((_, i) => i % 6 === 0),
      })
    }
    return out
  }, [life, target, fit, habits, fin, tasks])
}

/** The signed-in user's public scorecard, built from their real data. */
export function useMyScorecard(): Scorecard {
  const life = D.useLifeScore(30)
  const target = D.useOnTarget(30)
  const trophies = D.useTrophies()
  const fit = fitStore.use((s) => s)
  const tasks = useStats(30)
  return useMemo(
    () => ({
      life: life.score ?? 0,
      delta: life.delta ?? 0,
      streak: target.current,
      best: target.best,
      rates: life.rates,
      stats: [
        { label: "Workouts", value: String(C.finished(fit).length) },
        { label: "PRs", value: String(C.allPrs(fit).length) },
        { label: "Tasks (30d)", value: String(tasks.done) },
      ],
      trophies: trophies.slice(0, 8).map((x) => ({
        type: x.type,
        title: x.title,
        value: x.value,
      })),
    }),
    [life, target, trophies, fit, tasks],
  )
}
