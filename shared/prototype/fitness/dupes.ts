"use client"
import { createStore } from "../lib/store"
import { exerciseHistory, liveExercises } from "./calc"
import type { Equipment, Exercise, FitnessState } from "./data"
import { STARTER_EXERCISES } from "./starter"

/** Exercise pairs the person said are not duplicates, as sorted
 * "idA|idB" keys. Kept on this phone only: suggestions are advice, and the
 * fitness settings row (which syncs) is no place for them. */
export const dupesStore = createStore("exerciseDupes", () => ({
  dismissed: [] as string[],
}))

export type DupeReason = "same name" | "name contains"
export interface DupePair {
  keep: Exercise
  merge: Exercise
  reason: DupeReason
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|")

/** Lower case, punctuation and hyphens gone, single spaces, and a trailing
 * "s" dropped from each word ("Pull-ups" and "pullup" match). */
export function normaliseName(name: string): string {
  return words(name).join(" ")
}
function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/-/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
}

/** Words that only say what an exercise is done with. */
const EQUIPMENT_WORDS: Record<string, Equipment> = {
  barbell: "barbell",
  bb: "barbell",
  dumbbell: "dumbbell",
  db: "dumbbell",
  machine: "machine",
  cable: "cable",
  bodyweight: "bodyweight",
  bw: "bodyweight",
}

/** Whether ``long``'s name is ``short``'s plus equipment words that agree
 * with ``long``'s equipment ("Bench Press" in "Barbell Bench Press"). */
function onlyAddsEquipment(short: Exercise, long: Exercise): boolean {
  const a = new Set(words(short.name)),
    b = new Set(words(long.name))
  if (a.size >= b.size || [...a].some((w) => !b.has(w))) return false
  return [...b]
    .filter((w) => !a.has(w))
    .every((w) => EQUIPMENT_WORDS[w] === long.equipment)
}

/** Likely duplicate pairs among live exercises of one load type, with the
 * one to keep: more finished sessions, then the starter one, then the
 * older (earlier in the library). Pairs the person dismissed are left
 * out. */
export function duplicateCandidates(
  s: FitnessState,
  dismissed: readonly string[] = dupesStore.get().dismissed,
): DupePair[] {
  const live = liveExercises(s).filter((e) => !e.archived),
    hidden = new Set(dismissed),
    order = new Map(s.exercises.map((e, i) => [e.id, i])),
    sessions = new Map(live.map((e) => [e.id, exerciseHistory(s, e.id).length]))
  const rank = (e: Exercise) => [
    -(sessions.get(e.id) ?? 0),
    STARTER_NAMES.has(e.name) ? 0 : 1,
    order.get(e.id) ?? 0,
  ]
  const before = (a: Exercise, b: Exercise) => {
    const ra = rank(a),
      rb = rank(b)
    for (let i = 0; i < ra.length; i++)
      if (ra[i] !== rb[i]) return ra[i] < rb[i]
    return false
  }
  const out: DupePair[] = []
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i],
        b = live[j]
      if (a.loadType !== b.loadType || hidden.has(pairKey(a.id, b.id)))
        continue
      let reason: DupeReason | null = null
      if (normaliseName(a.name) === normaliseName(b.name)) reason = "same name"
      else if (
        a.muscle === b.muscle &&
        // A barbell "Bench Press" is not a "Dumbbell Bench Press".
        a.equipment === b.equipment &&
        (onlyAddsEquipment(a, b) || onlyAddsEquipment(b, a))
      )
        reason = "name contains"
      if (!reason) continue
      const [keep, merge] = before(b, a) ? [b, a] : [a, b]
      out.push({ keep, merge, reason })
    }
  return out
}

const STARTER_NAMES = new Set<string>(STARTER_EXERCISES.map((x) => x[1]))

/** Hide a suggested pair for good on this phone. */
export function dismissDuplicate(a: string, b: string) {
  const key = pairKey(a, b)
  dupesStore.set((d) =>
    d.dismissed.includes(key) ? d : { dismissed: [...d.dismissed, key] },
  )
}
