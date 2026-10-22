// A nutrient day by day against its goal, for the Nutrition page's history
// chart: whether each logged day hit it, how many did, and the average.
import { dayOffset } from "../lib/day"
import { dayTotals, mealsOn, targetFor } from "./calc"
import type { FitnessState } from "./data"
import { dayDetail, fiberGoalFor, limitsFor } from "./limits"

export type NutrientMetric =
  | "protein"
  | "kcal"
  | "carbs"
  | "fat"
  | "fiber"
  | "satFat"
  | "sugar"
  | "sodium"

/** How a metric's goal reads: reach it (protein, fiber), land near it
 * (calories, carbs, fat), or stay under it (the limits). */
export type GoalKind = "reach" | "near" | "under"

export const METRICS: Record<
  NutrientMetric,
  { label: string; unit: string; kind: GoalKind }
> = {
  protein: { label: "Protein", unit: "g", kind: "reach" },
  kcal: { label: "Calories", unit: "kcal", kind: "near" },
  carbs: { label: "Carbs", unit: "g", kind: "near" },
  fat: { label: "Fat", unit: "g", kind: "near" },
  fiber: { label: "Fiber", unit: "g", kind: "reach" },
  satFat: { label: "Sat fat", unit: "g", kind: "under" },
  sugar: { label: "Sugar", unit: "g", kind: "under" },
  sodium: { label: "Sodium", unit: "mg", kind: "under" },
}

/** Protein counts as hit from 90% of the goal (as the day verdict does);
 * calories, carbs and fat within 10% either side. */
const REACH = 0.9
const NEAR = 0.1

/** "open": today, while the result can still change. */
export type DayStatus = "hit" | "miss" | "over" | "open" | "none"

export interface HistoryPoint {
  day: string
  /** null: nothing logged that day, or this detail wasn't recorded. */
  value: number | null
  goal: number | null
  status: DayStatus
}

export interface NutrientHistory {
  metric: NutrientMetric
  points: HistoryPoint[]
  /** Days with a value, a goal and a settled result, and how many hit. */
  judged: number
  hit: number
  /** Average over days with a value; the goal averaged over the same days. */
  avg: number | null
  avgGoal: number | null
}

export function statusOf(
  kind: GoalKind,
  value: number,
  goal: number,
): DayStatus {
  if (kind === "reach") return value >= goal * REACH ? "hit" : "miss"
  if (kind === "under") return value <= goal ? "hit" : "over"
  if (value > goal * (1 + NEAR)) return "over"
  return value >= goal * (1 - NEAR) ? "hit" : "miss"
}

export function nutrientHistory(
  s: FitnessState,
  metric: NutrientMetric,
  days: number,
): NutrientHistory {
  const { kind } = METRICS[metric]
  const points: HistoryPoint[] = []
  const today = dayOffset(0)
  for (let i = -days + 1; i <= 0; i++) {
    const day = dayOffset(i)
    const { totals, count } = dayTotals(s, day)
    const target = targetFor(s, day)
    const detail = dayDetail(mealsOn(s, day))
    const value =
      count === 0
        ? null
        : metric === "kcal" ||
            metric === "protein" ||
            metric === "carbs" ||
            metric === "fat"
          ? totals[metric]
          : (detail[metric] ?? null)
    const goal =
      metric === "fiber"
        ? fiberGoalFor(target)
        : metric === "satFat" || metric === "sugar" || metric === "sodium"
          ? limitsFor(target)[metric]
          : (target?.[metric] ?? null)
    let status: DayStatus =
      value === null || goal === null ? "none" : statusOf(kind, value, goal)
    // Today is judged only once it can't change back: protein reached, or a
    // limit already passed. Short so far is still open.
    if (
      day === today &&
      (kind === "reach" ? status === "miss" : status !== "over") &&
      status !== "none"
    )
      status = "open"
    points.push({
      day,
      value: value === null ? null : Math.round(value * 10) / 10,
      goal,
      status,
    })
  }
  const withValue = points.filter((p) => p.value !== null)
  const judged = withValue.filter((p) => p.goal !== null && p.status !== "open")
  const goals = judged.map((p) => p.goal as number)
  return {
    metric,
    points,
    judged: judged.length,
    hit: judged.filter((p) => p.status === "hit").length,
    avg: withValue.length
      ? withValue.reduce((a, p) => a + (p.value as number), 0) /
        withValue.length
      : null,
    avgGoal: goals.length
      ? goals.reduce((a, b) => a + b, 0) / goals.length
      : null,
  }
}
