// A logged set against the same set last time, for the workout logger's
// "Last" column once the set is ticked: more weight or more reps (green),
// a set that had no last time ("New set"), the same, or honestly lower.
// Weights are stored in kg; the change is told in the set's own unit.

import type { WorkoutSet } from "@domain/fitness/data"
import { displayMass } from "./units"

export type SetProgress =
  | { kind: "new"; label: string }
  | { kind: "up" | "same" | "down"; label: string }

type Mass = Pick<WorkoutSet, "weight" | "reps" | "unit">

/** Below this, two stored weights are the same plate (lb round-trips to the
 * gram, so 120 lb last time and 120 lb now match). */
const SAME_KG = 0.05

const num = (v: number) =>
  Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 1 })
const signed = (v: number) => `${v > 0 ? "+" : "−"}${num(v)}`

/** Estimated one-rep max (Epley), to weigh more weight against fewer reps. */
const e1rm = (x: Mass) => x.weight * (1 + x.reps / 30)

export function setProgress(
  set: Mass,
  last: Mass | undefined,
  /** The settings unit, for a set that has none of its own. */
  fallbackUnit: "kg" | "lb",
): SetProgress {
  if (!last) return { kind: "new", label: "New set" }
  const unit = set.unit ?? fallbackUnit,
    sameWeight = Math.abs(set.weight - last.weight) < SAME_KG,
    weightDelta = sameWeight
      ? 0
      : displayMass(set.weight, unit) - displayMass(last.weight, unit),
    repDelta = set.reps - last.reps
  const parts = [
    weightDelta ? `${signed(weightDelta)} ${unit}` : "",
    repDelta
      ? `${signed(repDelta)} ${Math.abs(repDelta) === 1 ? "rep" : "reps"}`
      : "",
  ].filter(Boolean)
  if (!parts.length) return { kind: "same", label: "Same as last" }
  // Same weight: reps decide. Otherwise the estimated max does, so +5 lb
  // for one rep fewer still reads as a step up, and −3 reps does not.
  const diff =
    sameWeight || !set.weight || !last.weight
      ? repDelta || weightDelta
      : e1rm(set) - e1rm(last)
  return {
    kind: diff > 0 ? "up" : diff < 0 ? "down" : "same",
    label: parts.join(" · "),
  }
}

/** Whether a done set meets the exercise's goal for today (the header's
 * "+1 rep" or "+2.5 kg" target): at least the goal weight for at least the
 * goal reps. */
export function meetsGoal(
  set: Pick<WorkoutSet, "weight" | "reps">,
  goal: { weight: number; reps: number },
) {
  return set.weight >= goal.weight - SAME_KG && set.reps >= goal.reps
}
