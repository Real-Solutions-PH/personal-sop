import { dayKey, dayOffset, weekday } from "../lib/day"
import type {
  Exercise,
  FitnessState,
  Macros,
  MacroTarget,
  Meal,
  MealLabel,
  TemplateItem,
  WeighIn,
  Workout,
  WorkoutExercise,
  WorkoutSet,
} from "./data"
export const isDone = (s: WorkoutSet) => !!s.completedAt
/** Timed exercises (walking, running, planks) log time, not reps. */
export const isTimed = (ex: Pick<Exercise, "loadType"> | undefined) =>
  ex?.loadType === "time"
/** A timed set's seconds (older timed sets kept them in reps). */
export const setSeconds = (s: WorkoutSet) => s.durationSec ?? s.reps
/** 20 min · 1:30 · 45 s — how long a timed set ran. */
export function fmtSpan(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60),
    r = s % 60
  if (r === 0) return `${m} min`
  return `${m}:${String(r).padStart(2, "0")}`
}
/** "4 exercises · 9 sets · 20 min": timed exercises add their goal time,
 * not sets. */
export function templateSummary(
  items: readonly TemplateItem[],
  exercises: readonly Exercise[],
) {
  const timed = (it: TemplateItem) =>
    isTimed(exercises.find((e) => e.id === it.exerciseId))
  const sets = items.filter((it) => !timed(it)).reduce((a, i) => a + i.sets, 0)
  const secs = items.filter(timed).reduce((a, i) => a + (i.targetSec ?? 0), 0)
  return [
    `${items.length} exercise${items.length === 1 ? "" : "s"}`,
    ...(sets ? [`${sets} sets`] : []),
    ...(secs ? [fmtSpan(secs)] : []),
  ].join(" · ")
}

/** A timed exercise's default length: 10 minutes for cardio, a minute else. */
export const defaultSeconds = (ex: Pick<Exercise, "muscle"> | undefined) =>
  ex?.muscle === "cardio" ? 600 : 60
export const isWorking = (s: WorkoutSet) => s.kind !== "warmup"
export const kg = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} kg`
export const kgShort = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(1)
export const fmtVolume = (n: number) =>
  n >= 10000
    ? `${(n / 1000).toFixed(1)}t`
    : `${Math.round(n).toLocaleString()} kg`
export function e1rm(load: number, reps: number): number {
  if (reps <= 0 || reps > 12 || load <= 0) return 0
  return reps === 1 ? load : load * (1 + reps / 30)
}
export function latestWeighIn(s: FitnessState): WeighIn | undefined {
  return s.weighIns.reduce<WeighIn | undefined>(
    (a, w) => (!a || w.measuredAt > a.measuredAt ? w : a),
    undefined,
  )
}
export function latestBodyweight(s: FitnessState): number | undefined {
  return latestWeighIn(s)?.weightKg
}
/** Body fat from the newest weigh-in that has one. */
export function latestBodyFat(s: FitnessState): number | undefined {
  return latestWeighIn({
    ...s,
    weighIns: s.weighIns.filter((w) => w.bodyFatPct !== undefined),
  })?.bodyFatPct
}
export function exMap(s: FitnessState) {
  return new Map(s.exercises.map((e) => [e.id, e]))
}
export function setLoad(ex: Exercise | undefined, set: WorkoutSet, bw = 0) {
  return ex?.loadType === "bodyweight" ? bw + set.weight : set.weight
}
export interface ExStats {
  bestE1rm: number
  heaviest: number
  volume: number
  top?: WorkoutSet
  doneSets: number
}
export function exStats(
  we: WorkoutExercise,
  ex: Exercise | undefined,
  bw = 0,
): ExStats {
  let bestE1rm = 0
  let heaviest = 0
  let volume = 0
  let doneSets = 0
  let top: WorkoutSet | undefined
  for (const set of we.sets) {
    if (!isDone(set) || !isWorking(set)) continue
    doneSets++
    const load = setLoad(ex, set, bw)
    volume += load * set.reps
    const e = e1rm(load, set.reps)
    if (e > bestE1rm) {
      bestE1rm = e
      top = set
    }
    if (set.weight > heaviest) heaviest = set.weight
  }
  if (!bestE1rm)
    for (const set of we.sets) {
      if (!isDone(set) || !isWorking(set)) continue
      const load = setLoad(ex, set, bw)
      const e = load * (1 + set.reps / 30)
      if (e > bestE1rm) {
        bestE1rm = e
        top = set
      }
    }
  if (!top) top = we.sets.find((x) => isDone(x) && isWorking(x))
  return { bestE1rm, heaviest, volume, top, doneSets }
}
export function workoutTotals(s: FitnessState, w: Workout) {
  const m = exMap(s)
  const bw = latestBodyweight(s) ?? 0
  let volume = 0
  let done = 0
  let planned = 0
  for (const we of w.exercises) {
    const st = exStats(we, m.get(we.exerciseId), bw)
    volume += st.volume
    done += st.doneSets
    planned += we.sets.filter(isWorking).length
  }
  const end = w.endedAt ? new Date(w.endedAt).getTime() : Date.now()
  const durationSec = Math.max(
    0,
    (end - new Date(w.startedAt).getTime()) / 1000,
  )
  return { volume, done, planned, durationSec }
}
export const finished = (s: FitnessState) =>
  s.workouts
    .filter((w) => w.status === "finished")
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
export interface HistPoint {
  workout: Workout
  we: WorkoutExercise
  stats: ExStats
}
export function exerciseHistory(
  s: FitnessState,
  exerciseId: string,
): HistPoint[] {
  const ex = s.exercises.find((e) => e.id === exerciseId)
  const bw = latestBodyweight(s) ?? 0
  const out: HistPoint[] = []
  for (const w of finished(s))
    for (const we of w.exercises)
      if (we.exerciseId === exerciseId) {
        const stats = exStats(we, ex, bw)
        if (stats.doneSets) out.push({ workout: w, we, stats })
      }
  return out
}
export type PrKind = "e1rm" | "weight" | "volume"
export interface Pr {
  workoutId: string
  exerciseId: string
  kind: PrKind
  value: number
  prev: number
  at: string
}
export const prLabel: Record<PrKind, string> = {
  e1rm: "Est. 1-rep max",
  weight: "Heaviest",
  volume: "Volume",
}
export function allPrs(s: FitnessState, extra?: Workout): Pr[] {
  const m = exMap(s)
  const bw = latestBodyweight(s) ?? 0
  const best = new Map<string, Record<PrKind, number>>()
  const out: Pr[] = []
  const list = finished(s)
  if (extra && extra.status !== "finished") list.push(extra)
  for (const w of list)
    for (const we of w.exercises) {
      const ex = m.get(we.exerciseId)
      const st = exStats(we, ex, bw)
      if (!st.doneSets) continue
      const cur = { e1rm: st.bestE1rm, weight: st.heaviest, volume: st.volume }
      const prev = best.get(we.exerciseId)
      if (!prev) {
        best.set(we.exerciseId, cur)
        continue
      }
      let pushed = false
      for (const k of ["e1rm", "weight", "volume"] as PrKind[]) {
        if (
          cur[k] > prev[k] + 0.01 &&
          (k !== "weight" || ex?.loadType === "weight")
        ) {
          if (!pushed)
            out.push({
              workoutId: w.id,
              exerciseId: we.exerciseId,
              kind: k,
              value: cur[k],
              prev: prev[k],
              at: w.startedAt,
            })
          pushed = true
          prev[k] = cur[k]
        }
      }
    }
  return out
}
export function prsByWorkout(prs: Pr[]) {
  const m = new Map<string, Pr[]>()
  for (const p of prs) m.set(p.workoutId, [...(m.get(p.workoutId) ?? []), p])
  return m
}
export interface Suggestion {
  kind: "weight" | "reps" | "new" | "hold" | "time"
  weight: number
  reps: number
  badge: string
  detail: string
  last?: {
    weight: number
    reps: number[]
  }
}
export function suggestion(
  s: FitnessState,
  exerciseId: string,
  /** A template's time goal for a timed exercise. */
  targetSec?: number,
): Suggestion {
  const ex = s.exercises.find((e) => e.id === exerciseId)
  const hist = exerciseHistory(s, exerciseId)
  const last = hist.at(-1)
  if (isTimed(ex)) {
    const done = last?.we.sets.filter(isDone) ?? []
    const lastSec = done.reduce((a, x) => a + setSeconds(x), 0)
    const speed = done.find((x) => x.speedKmh)?.speedKmh
    const goal = targetSec ?? (lastSec || defaultSeconds(ex))
    return {
      kind: "time",
      weight: done[0]?.weight ?? 0,
      reps: 0,
      badge: targetSec ? `Goal ${fmtSpan(targetSec)}` : fmtSpan(goal),
      detail: lastSec
        ? `Last time ${fmtSpan(lastSec)}${speed ? ` at ${speed} km/h` : ""}.`
        : `First time — aim for ${fmtSpan(goal)}.`,
    }
  }
  if (!ex || !last)
    return {
      kind: "new",
      weight: 0,
      reps: ex?.repMin ?? 8,
      badge: "New",
      detail: `First time — pick a weight you can do for ${ex?.repMin ?? 8}–${ex?.repMax ?? 12} reps.`,
    }
  const work = last.we.sets.filter((x) => isDone(x) && isWorking(x))
  const weight = Math.max(...work.map((x) => x.weight))
  const reps = work.map((x) => x.reps)
  const lastInfo = { weight, reps }
  if (ex.loadType === "time" || ex.loadType === "reps")
    return {
      kind: "reps",
      weight,
      reps: Math.min(...reps) + 1,
      badge: "+1 rep",
      detail: "Beat last time by one.",
      last: lastInfo,
    }
  if (
    s.settings.progression === "linear" ||
    reps.every((r) => r >= ex.repMax)
  ) {
    const next = weight + ex.increment
    return {
      kind: "weight",
      weight: next,
      reps: ex.repMin,
      badge: `+${kgShort(ex.increment)} kg`,
      detail:
        s.settings.progression === "linear"
          ? `Linear: add ${kgShort(ex.increment)} kg each session.`
          : `All sets hit ${ex.repMax} last time — go ${kg(next)} × ${ex.repMin}.`,
      last: lastInfo,
    }
  }
  const target = Math.min(ex.repMax, Math.min(...reps) + 1)
  return {
    kind: "reps",
    weight,
    reps: target,
    badge: "+1 rep",
    detail: `Stay at ${kg(weight)}; aim ${target}+ reps on every set. Move up at ${ex.repMax}×${work.length}.`,
    last: lastInfo,
  }
}
export function isStalled(hist: HistPoint[]): boolean {
  const cutoff = dayOffset(-21)
  const recent = hist.filter(
    (h) => dayKey(new Date(h.workout.startedAt)) >= cutoff,
  )
  const before = hist.filter(
    (h) => dayKey(new Date(h.workout.startedAt)) < cutoff,
  )
  if (recent.length < 2 || before.length < 2) return false
  const bestBefore = Math.max(...before.map((h) => h.stats.bestE1rm))
  const bestRecent = Math.max(...recent.map((h) => h.stats.bestE1rm))
  return bestRecent <= bestBefore + 0.01
}
export function weekStart(key: string): string {
  const d = new Date(`${key}T12:00:00`)
  const off = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - off)
  return dayKey(new Date(d.getTime() + 4 * 3600000))
}
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + n)
  return dayKey(new Date(d.getTime() + 4 * 3600000))
}
export function sessionsByWeek(s: FitnessState, weeks: number) {
  const thisWeek = weekStart(dayKey())
  const out: {
    start: string
    count: number
  }[] = []
  for (let i = weeks - 1; i >= 0; i--)
    out.push({ start: addDays(thisWeek, -7 * i), count: 0 })
  for (const w of finished(s)) {
    const ws = weekStart(dayKey(new Date(w.startedAt)))
    const slot = out.find((o) => o.start === ws)
    if (slot) slot.count++
  }
  return out
}
export function consistencyStreak(s: FitnessState): number {
  const weeks = sessionsByWeek(s, 20).slice(0, -1).reverse()
  let n = 0
  for (const w of weeks) {
    if (w.count >= s.settings.weeklyTarget) n++
    else break
  }
  return n
}
export function dailyWeights(s: FitnessState): Map<string, number> {
  const sorted = [...s.weighIns].sort((a, b) =>
    a.measuredAt.localeCompare(b.measuredAt),
  )
  const m = new Map<string, number>()
  for (const w of sorted) {
    const k = dayKey(new Date(w.measuredAt))
    if (!m.has(k)) m.set(k, w.weightKg)
  }
  return m
}
export interface TrendPoint {
  day: string
  raw?: number
  avg?: number
}
export function weightTrend(s: FitnessState, days: number): TrendPoint[] {
  const daily = dailyWeights(s)
  const out: TrendPoint[] = []
  for (let i = -days + 1; i <= 0; i++) {
    const day = dayOffset(i)
    const win: number[] = []
    for (let j = 0; j < 7; j++) {
      const v = daily.get(addDays(day, -j))
      if (v !== undefined) win.push(v)
    }
    out.push({
      day,
      raw: daily.get(day),
      avg: win.length ? win.reduce((a, b) => a + b, 0) / win.length : undefined,
    })
  }
  return out
}
export function avgOver(s: FitnessState, fromOffset: number, toOffset: number) {
  const daily = dailyWeights(s)
  const v: number[] = []
  for (let i = fromOffset; i <= toOffset; i++) {
    const x = daily.get(dayOffset(i))
    if (x !== undefined) v.push(x)
  }
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
}
export function weeklyRate(s: FitnessState) {
  const cur = avgOver(s, -6, 0)
  const prev = avgOver(s, -13, -7)
  if (cur === undefined || prev === undefined) return undefined
  return { kg: cur - prev, pct: ((cur - prev) / prev) * 100, avg: cur }
}
export const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0 })
export function sumMacros(list: Macros[]): Macros {
  const t = zero()
  for (const m of list) {
    t.kcal += m.kcal
    t.protein += m.protein
    t.carbs += m.carbs
    t.fat += m.fat
  }
  return t
}
export const mealTotals = (m: Meal) => sumMacros(m.items)
export const mealDay = (m: Meal) => dayKey(new Date(m.eatenAt))
export function mealsOn(s: FitnessState, day: string) {
  return s.meals
    .filter((m) => mealDay(m) === day)
    .sort((a, b) => a.eatenAt.localeCompare(b.eatenAt))
}
export function dayTotals(s: FitnessState, day: string) {
  const meals = mealsOn(s, day)
  return {
    totals: sumMacros(
      meals.filter((m) => m.status !== "pending_estimate").map(mealTotals),
    ),
    pending: meals.filter((m) => m.status === "pending_estimate").length,
    toReview: meals.filter((m) => m.status === "estimated").length,
    count: meals.length,
  }
}
export function targetFor(
  s: FitnessState,
  day: string,
): MacroTarget | undefined {
  return [...s.targets]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
    .filter((t) => t.effectiveFrom <= day)
    .at(-1)
}
export function adjustmentOn(s: FitnessState, day: string): number {
  // ?? []: states built elsewhere (web wiring, fixtures) may predate the field.
  return (s.adjustments ?? []).find((a) => a.day === day)?.kcal ?? 0
}
/** The day's budget: its target plus the burned kcal the user added that
 * day. Protein stays; the extra kcal go to carbs and fat in the target's
 * carbs:fat calorie ratio (all to carbs when it has neither), in whole
 * grams. Editors use
 * targetFor, so an eat-back never gets saved into a target. */
export function budgetFor(
  s: FitnessState,
  day: string,
): MacroTarget | undefined {
  const t = targetFor(s, day)
  const extra = adjustmentOn(s, day)
  if (!t || extra <= 0) return t
  const carbKcal = t.carbs * 4,
    fatKcal = t.fat * 9,
    both = carbKcal + fatKcal,
    carbShare = both > 0 ? carbKcal / both : 1
  return {
    ...t,
    kcal: t.kcal + extra,
    carbs: Math.round(t.carbs + (extra * carbShare) / 4),
    fat: Math.round(t.fat + (extra * (1 - carbShare)) / 9),
  }
}
export type DayVerdict = "hit" | "over" | "under" | "none"
export interface DayNutrition {
  day: string
  totals: Macros
  target?: MacroTarget
  meals: number
  kcalOk: boolean
  proteinHit: boolean
  over: boolean
  verdict: DayVerdict
}
export function nutritionDays(s: FitnessState, days: number): DayNutrition[] {
  const out: DayNutrition[] = []
  for (let i = -days + 1; i <= 0; i++) {
    const day = dayOffset(i)
    const { totals, count } = dayTotals(s, day)
    const target = budgetFor(s, day)
    const kcalOk =
      !!target &&
      count > 0 &&
      Math.abs(totals.kcal - target.kcal) <= target.kcal * 0.1
    const over = !!target && totals.kcal > target.kcal * 1.1
    const proteinHit = !!target && totals.protein >= target.protein * 0.9
    out.push({
      day,
      totals,
      target,
      meals: count,
      kcalOk,
      proteinHit,
      over,
      verdict:
        count === 0 || !target
          ? "none"
          : over
            ? "over"
            : kcalOk
              ? "hit"
              : "under",
    })
  }
  return out
}
export function adherence(s: FitnessState, days: number, offset = 0) {
  const list = nutritionDays(s, days + offset + 1).slice(0, days)
  const logged = list.filter((d) => d.meals > 0 && d.target)
  const pct = (n: number) => (logged.length ? n / logged.length : 0)
  return {
    days: list,
    logged: logged.length,
    calorie: pct(logged.filter((d) => d.kcalOk).length),
    protein: pct(logged.filter((d) => d.proteinHit).length),
    overDays: logged.filter((d) => d.over).length,
    coverage: list.length
      ? list.filter((d) => d.meals >= 2).length / list.length
      : 0,
  }
}
export function labelForTime(d: Date = new Date()): MealLabel {
  const h = d.getHours()
  if (h >= 4 && h < 10) return "breakfast"
  if (h >= 10 && h < 15) return "lunch"
  if (h >= 17 && h < 22) return "dinner"
  return "snack"
}
export function relDay(iso: string): string {
  const k = dayKey(new Date(iso))
  if (k === dayKey()) return "Today"
  if (k === dayOffset(-1)) return "Yesterday"
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 86400000
  if (diff < 6) return d.toLocaleDateString("en-PH", { weekday: "short" })
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" })
}
export const fmtDay = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })
export const fmtMin = (sec: number) => {
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`
}
export function nextTemplate(s: FitnessState) {
  const last = finished(s).at(-1)
  if (!s.templates.length) return undefined
  const i = s.templates.findIndex((t) => t.id === last?.templateId)
  return s.templates[(i + 1) % s.templates.length]
}
/** The weekly routine's slot index (0 = Mon … 6 = Sun) for a day key,
 * matching weekStart()'s Monday-first weeks. */
export const scheduleIndex = (key: string = dayKey()) => (weekday(key) + 6) % 7
/** A day is a planned rest day when its slot is explicitly null. */
export const isRestDay = (s: FitnessState, key: string = dayKey()) =>
  s.schedule[scheduleIndex(key)] === null
/** The template scheduled for a day — undefined on a rest day, or when the
 * slot points at a template that no longer exists. */
export function scheduledTemplate(s: FitnessState, key: string = dayKey()) {
  const id = s.schedule[scheduleIndex(key)]
  return id ? s.templates.find((t) => t.id === id) : undefined
}
/** Training days the plan asks for each week — the count of non-rest slots,
 * falling back to the manual weeklyTarget when no routine is set. */
export function weeklyGoal(s: FitnessState) {
  return s.schedule.filter((d) => d !== null).length || s.settings.weeklyTarget
}
export function lastOfTemplate(s: FitnessState, templateId: string) {
  return finished(s)
    .filter((w) => w.templateId === templateId)
    .at(-1)
}
export function overloadRate(s: FitnessState, days: number) {
  const from = dayOffset(-days)
  let up = 0
  let n = 0
  for (const ex of s.exercises) {
    const h = exerciseHistory(s, ex.id).filter(
      (x) =>
        dayKey(new Date(x.workout.startedAt)) >= from && x.stats.bestE1rm > 0,
    )
    if (h.length < 2) continue
    n++
    if ((h.at(-1)?.stats.bestE1rm ?? 0) > h[0].stats.bestE1rm + 0.01) up++
  }
  return n ? up / n : 0
}
export function periodSummary(s: FitnessState, days: number, endOffset = 0) {
  const from = dayOffset(endOffset - days + 1)
  const to = dayOffset(endOffset)
  const ws = finished(s).filter((w) => {
    const k = dayKey(new Date(w.startedAt))
    return k >= from && k <= to
  })
  const prs = allPrs(s).filter((p) => {
    const k = dayKey(new Date(p.at))
    return k >= from && k <= to
  })
  const target = (s.settings.weeklyTarget * days) / 7
  return {
    sessions: ws.length,
    target,
    sessionRate: Math.min(1, ws.length / Math.max(1, target)),
    missed: Math.max(0, Math.round(target - ws.length)),
    prs: prs.length,
    volume: ws.reduce((a, w) => a + workoutTotals(s, w).volume, 0),
  }
}
