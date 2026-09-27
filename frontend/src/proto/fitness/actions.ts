"use client"

import { dayKey } from "../lib/day"
import { liveStore, startLive, stopLive } from "../lib/live"
import { uid } from "../lib/store"
import {
  exerciseHistory,
  isDone,
  isWorking,
  labelForTime,
  suggestion,
  targetFor,
} from "./calc"
import {
  type Exercise,
  type FitnessSettings,
  FOODS,
  type Food,
  itemFromFood,
  type Macros,
  type MacroTarget,
  type Meal,
  type MealItem,
  type MealLabel,
  type MealSource,
  type WeighIn,
  type Workout,
  type WorkoutExercise,
  type WorkoutSet,
  type WorkoutTemplate,
} from "./data"
import { fitStore } from "./store"

// Write API for M3 Fitness. Screens and Capture (M5) call these. Every create
// returns the record so the caller can show it and offer undo.

const now = () => new Date().toISOString()
export const WORKOUT_HREF = "/fitness/workout"

// ── Cross-module hook point (X-7) ──

type FinishedListener = (w: Workout) => void
const finishedListeners = new Set<FinishedListener>()

/** Subscribe to finished workouts (habits wires "any workout logged" auto-check here). Returns unsubscribe. */
export function onWorkoutFinished(cb: FinishedListener): () => void {
  finishedListeners.add(cb)
  return () => finishedListeners.delete(cb)
}

// ── Workouts ──

function patchWorkout(id: string, fn: (w: Workout) => Workout) {
  fitStore.set((s) => ({
    ...s,
    workouts: s.workouts.map((w) => (w.id === id ? fn(w) : w)),
  }))
}

function patchExercise(
  workoutId: string,
  weId: string,
  fn: (we: WorkoutExercise) => WorkoutExercise,
) {
  patchWorkout(workoutId, (w) => ({
    ...w,
    exercises: w.exercises.map((e) => (e.id === weId ? fn(e) : e)),
  }))
}

/** Planned (unchecked) sets for an exercise: last session's sets, bumped by the overload suggestion. */
export function plannedSets(exerciseId: string, count = 3): WorkoutSet[] {
  const s = fitStore.get()
  const ex = s.exercises.find((e) => e.id === exerciseId)
  const last = exerciseHistory(s, exerciseId).at(-1)
  const sug = suggestion(s, exerciseId)
  if (!ex || !last)
    return [{ id: uid(), reps: ex?.repMin ?? 8, weight: 0, kind: "working" }]
  const warm = last.we.sets
    .filter((x) => x.kind === "warmup")
    .map((x) => ({ id: uid(), reps: x.reps, weight: x.weight, kind: x.kind }))
  const work = last.we.sets.filter((x) => isWorking(x) && isDone(x))
  const n = Math.max(count, 1)
  const sets: WorkoutSet[] = Array.from({ length: n }, (_, i) => {
    const prev = work[Math.min(i, work.length - 1)]
    if (sug.kind === "weight")
      return { id: uid(), reps: sug.reps, weight: sug.weight, kind: "working" }
    return {
      id: uid(),
      reps: Math.min(ex.repMax, Math.max(prev?.reps ?? ex.repMin, sug.reps)),
      weight: prev?.weight ?? sug.weight,
      kind: "working",
    }
  })
  return [...warm, ...sets]
}

export type StartFrom =
  | { from: "empty" }
  | { from: "template"; templateId: string }
  | { from: "repeat"; workoutId: string }

export type StartResult =
  | { ok: true; workout: Workout }
  | { ok: false; reason: string; href?: string }

/** Start a live workout (empty / template / repeat a past one). Registers it in the global Live bar. */
export function startWorkout(opts: StartFrom): StartResult {
  const s = fitStore.get()
  const active = s.workouts.find(
    (w) => w.id === s.activeId && w.status === "in_progress",
  )
  if (active) return { ok: true, workout: active }
  const live = liveStore.get().live
  if (live && live.href !== WORKOUT_HREF)
    return {
      ok: false,
      reason: `“${live.label}” is running — finish it first.`,
      href: live.href,
    }

  let name = "Workout"
  let templateId: string | undefined
  let items: { exerciseId: string; sets: number }[] = []
  if (opts.from === "template") {
    const t = s.templates.find((x) => x.id === opts.templateId)
    if (t) {
      name = t.name
      templateId = t.id
      items = t.items
    }
  } else if (opts.from === "repeat") {
    const src = s.workouts.find((x) => x.id === opts.workoutId)
    if (src) {
      name = src.name
      templateId = src.templateId
      items = src.exercises.map((e) => ({
        exerciseId: e.exerciseId,
        sets: e.sets.filter(isWorking).length || 3,
      }))
    }
  } else {
    const h = new Date().getHours()
    name =
      h < 12
        ? "Morning workout"
        : h < 17
          ? "Afternoon workout"
          : "Evening workout"
  }
  const workout: Workout = {
    id: uid(),
    name,
    templateId,
    startedAt: now(),
    status: "in_progress",
    clientId: uid(),
    source: "live",
    exercises: items.map((it) => ({
      id: uid(),
      exerciseId: it.exerciseId,
      sets: plannedSets(it.exerciseId, it.sets),
    })),
  }
  fitStore.set((st) => ({
    ...st,
    workouts: [...st.workouts, workout],
    activeId: workout.id,
    rest: null,
  }))
  startLive({ kind: "workout", label: liveLabel(workout), href: WORKOUT_HREF })
  return { ok: true, workout }
}

function liveLabel(w: Workout) {
  const sets = w.exercises.flatMap((e) => e.sets.filter(isWorking))
  return `${w.name} · ${sets.filter(isDone).length}/${sets.length} sets`
}

function syncLive(workoutId: string) {
  const w = fitStore.get().workouts.find((x) => x.id === workoutId)
  const live = liveStore.get().live
  if (w?.status !== "in_progress" || live?.kind !== "workout") return
  liveStore.set({ live: { ...live, label: liveLabel(w) } })
}

/** 1-tap: complete (or un-complete) a set; completing starts the rest timer. */
export function toggleSet(workoutId: string, weId: string, setId: string) {
  let completed = false
  patchExercise(workoutId, weId, (we) => ({
    ...we,
    sets: we.sets.map((x) => {
      if (x.id !== setId) return x
      completed = !x.completedAt
      return { ...x, completedAt: x.completedAt ? undefined : now() }
    }),
  }))
  const s = fitStore.get()
  if (completed && s.activeId === workoutId) startRest()
  syncLive(workoutId)
  return completed
}

/** Edit a set's weight / reps / kind. */
export function updateSet(
  workoutId: string,
  weId: string,
  setId: string,
  patch: Partial<Omit<WorkoutSet, "id">>,
) {
  patchExercise(workoutId, weId, (we) => ({
    ...we,
    sets: we.sets.map((x) => (x.id === setId ? { ...x, ...patch } : x)),
  }))
  syncLive(workoutId)
}

/** Append a set copying the last one (unchecked). */
export function addSet(workoutId: string, weId: string): WorkoutSet {
  const w = fitStore.get().workouts.find((x) => x.id === workoutId)
  const we = w?.exercises.find((e) => e.id === weId)
  const last = we?.sets.filter(isWorking).at(-1)
  const set: WorkoutSet = {
    id: uid(),
    reps: last?.reps ?? 8,
    weight: last?.weight ?? 0,
    kind: "working",
  }
  patchExercise(workoutId, weId, (e) => ({ ...e, sets: [...e.sets, set] }))
  syncLive(workoutId)
  return set
}

/** Delete a set. */
export function removeSet(workoutId: string, weId: string, setId: string) {
  patchExercise(workoutId, weId, (e) => ({
    ...e,
    sets: e.sets.filter((x) => x.id !== setId),
  }))
  syncLive(workoutId)
}

/** Add exercises (prefilled from last time + suggestion). */
export function addExercises(workoutId: string, exerciseIds: string[]) {
  const added = exerciseIds.map((exerciseId) => ({
    id: uid(),
    exerciseId,
    sets: plannedSets(exerciseId, 3),
  }))
  patchWorkout(workoutId, (w) => ({
    ...w,
    exercises: [...w.exercises, ...added],
  }))
  syncLive(workoutId)
  return added
}

/** Remove an exercise from a workout. */
export function removeExercise(workoutId: string, weId: string) {
  patchWorkout(workoutId, (w) => ({
    ...w,
    exercises: w.exercises.filter((e) => e.id !== weId),
  }))
  syncLive(workoutId)
}

/** Move an exercise up (-1) or down (+1). */
export function moveExercise(workoutId: string, weId: string, dir: -1 | 1) {
  patchWorkout(workoutId, (w) => {
    const list = [...w.exercises]
    const i = list.findIndex((e) => e.id === weId)
    const j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return w
    ;[list[i], list[j]] = [list[j], list[i]]
    return { ...w, exercises: list }
  })
}

/** Swap an exercise for another, re-prefilling its sets. */
export function replaceExercise(
  workoutId: string,
  weId: string,
  exerciseId: string,
) {
  patchExercise(workoutId, weId, (e) => ({
    ...e,
    exerciseId,
    sets: plannedSets(exerciseId, e.sets.filter(isWorking).length || 3),
  }))
  syncLive(workoutId)
}

/** Per-exercise note in a workout. */
export function setExerciseNote(workoutId: string, weId: string, note: string) {
  patchExercise(workoutId, weId, (e) => ({ ...e, note }))
}

/** Rename / annotate a workout. */
export function updateWorkoutMeta(
  id: string,
  patch: { name?: string; notes?: string },
) {
  patchWorkout(id, (w) => ({ ...w, ...patch }))
}

// Rest timer

/** Start the rest countdown (defaults to settings.restSec). */
export function startRest(sec?: number) {
  fitStore.set((s) => {
    const d = sec ?? s.settings.restSec
    return {
      ...s,
      rest: {
        durationSec: d,
        endsAt: new Date(Date.now() + d * 1000).toISOString(),
      },
    }
  })
}
/** ±seconds on the running rest timer. */
export function adjustRest(delta: number) {
  fitStore.set((s) =>
    s.rest
      ? {
          ...s,
          rest: {
            durationSec: Math.max(0, s.rest.durationSec + delta),
            endsAt: new Date(
              new Date(s.rest.endsAt).getTime() + delta * 1000,
            ).toISOString(),
          },
        }
      : s,
  )
}
/** Dismiss the rest timer. */
export const skipRest = () => fitStore.set((s) => ({ ...s, rest: null }))

/** Last activity timestamp of a workout (last completed set, else start). */
export function lastActivity(w: Workout): string {
  let t = w.startedAt
  for (const e of w.exercises)
    for (const x of e.sets)
      if (x.completedAt && x.completedAt > t) t = x.completedAt
  return t
}

/**
 * Finish a workout. `unfinished`: what to do with planned sets never checked
 * ("remove" default, or "done" to mark them done). `endAt` backdates the end (resume sheet).
 */
export function finishWorkout(
  id: string,
  opts: { unfinished?: "remove" | "done"; endAt?: string } = {},
): Workout | undefined {
  const endedAt = opts.endAt ?? now()
  patchWorkout(id, (w) => ({
    ...w,
    status: "finished",
    endedAt,
    exercises: w.exercises
      .map((e) => ({
        ...e,
        sets:
          opts.unfinished === "done"
            ? e.sets.map((x) =>
                x.completedAt ? x : { ...x, completedAt: endedAt },
              )
            : e.sets.filter((x) => x.completedAt),
      }))
      .filter((e) => e.sets.length),
  }))
  fitStore.set((s) => ({
    ...s,
    activeId: s.activeId === id ? null : s.activeId,
    rest: null,
  }))
  if (liveStore.get().live?.kind === "workout") stopLive()
  const w = fitStore.get().workouts.find((x) => x.id === id)
  if (w) for (const cb of finishedListeners) cb(w)
  return w
}

/** Throw away the in-progress workout. */
export function discardWorkout(id: string) {
  fitStore.set((s) => ({
    ...s,
    workouts: s.workouts.filter((w) => w.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
    rest: s.activeId === id ? null : s.rest,
  }))
  if (liveStore.get().live?.kind === "workout") stopLive()
}

/** Delete a finished workout; returns it for undo. */
export function deleteWorkout(id: string): Workout | undefined {
  const w = fitStore.get().workouts.find((x) => x.id === id)
  fitStore.set((s) => ({
    ...s,
    workouts: s.workouts.filter((x) => x.id !== id),
  }))
  return w
}

/** Undo for deleteWorkout. */
export function restoreWorkout(w: Workout) {
  fitStore.set((s) => ({ ...s, workouts: [...s.workouts, w] }))
}

/**
 * Capture backfill (F-FIT-11): "did legs: squat 3x5 100, RDL 3x8 80" → finished workout.
 * Exercises are matched by id or case-insensitive name; unknown names are created.
 */
export function logWorkoutFromChat(input: {
  name: string
  day?: string
  exercises: { exercise: string; sets: { reps: number; weight: number }[] }[]
}): Workout {
  const day = input.day ?? dayKey()
  const start = new Date(`${day}T18:30:00`).toISOString()
  const exs = input.exercises.map((e) => {
    const found =
      fitStore
        .get()
        .exercises.find(
          (x) =>
            x.id === e.exercise ||
            x.name.toLowerCase() === e.exercise.toLowerCase(),
        ) ?? upsertExercise({ name: e.exercise })
    return {
      id: uid(),
      exerciseId: found.id,
      sets: e.sets.map((x) => ({
        id: uid(),
        ...x,
        kind: "working" as const,
        completedAt: start,
      })),
    }
  })
  const w: Workout = {
    id: uid(),
    name: input.name,
    startedAt: start,
    endedAt: new Date(new Date(start).getTime() + 60 * 60_000).toISOString(),
    status: "finished",
    exercises: exs,
    clientId: uid(),
    source: "chat",
  }
  fitStore.set((s) => ({ ...s, workouts: [...s.workouts, w] }))
  for (const cb of finishedListeners) cb(w)
  return w
}

// ── Templates ──

/** Create or update a template. */
export function upsertTemplate(
  t: Partial<WorkoutTemplate> & { name: string },
): WorkoutTemplate {
  const full: WorkoutTemplate = {
    id: t.id ?? uid(),
    name: t.name,
    items: t.items ?? [],
  }
  fitStore.set((s) => ({
    ...s,
    templates: s.templates.some((x) => x.id === full.id)
      ? s.templates.map((x) => (x.id === full.id ? full : x))
      : [...s.templates, full],
  }))
  return full
}

/** Save a workout's exercise list as a new template. */
export function saveAsTemplate(
  workoutId: string,
  name?: string,
): WorkoutTemplate | undefined {
  const w = fitStore.get().workouts.find((x) => x.id === workoutId)
  if (!w) return
  return upsertTemplate({
    name: name ?? `${w.name} (copy)`,
    items: w.exercises.map((e) => ({
      exerciseId: e.exerciseId,
      sets: e.sets.filter(isWorking).length || 3,
    })),
  })
}

/** Delete a template; returns it for undo. */
export function deleteTemplate(id: string): WorkoutTemplate | undefined {
  const t = fitStore.get().templates.find((x) => x.id === id)
  fitStore.set((s) => ({
    ...s,
    templates: s.templates.filter((x) => x.id !== id),
  }))
  return t
}

// ── Exercises ──

/** Create or edit an exercise. */
export function upsertExercise(
  e: Partial<Exercise> & { name: string },
): Exercise {
  const full: Exercise = {
    id: e.id ?? uid(),
    name: e.name.trim(),
    equipment: e.equipment ?? "barbell",
    muscle: e.muscle ?? "chest",
    loadType: e.loadType ?? "weight",
    repMin: e.repMin ?? 8,
    repMax: e.repMax ?? 12,
    increment: e.increment ?? 2.5,
    archived: e.archived,
  }
  fitStore.set((s) => ({
    ...s,
    exercises: s.exercises.some((x) => x.id === full.id)
      ? s.exercises.map((x) => (x.id === full.id ? full : x))
      : [...s.exercises, full],
  }))
  return full
}

/** Archive keeps history; hides from the picker. */
export function setExerciseArchived(id: string, archived: boolean) {
  fitStore.set((s) => ({
    ...s,
    exercises: s.exercises.map((x) => (x.id === id ? { ...x, archived } : x)),
  }))
}

// ── Body weight ──

/** Log a weigh-in (defaults to now). */
export function logWeighIn(
  weightKg: number,
  measuredAt?: string,
  note?: string,
): WeighIn {
  const w: WeighIn = {
    id: uid(),
    weightKg: Math.round(weightKg * 10) / 10,
    measuredAt: measuredAt ?? now(),
    note,
  }
  fitStore.set((s) => ({ ...s, weighIns: [...s.weighIns, w] }))
  return w
}

/** Edit a weigh-in. */
export function updateWeighIn(id: string, patch: Partial<Omit<WeighIn, "id">>) {
  fitStore.set((s) => ({
    ...s,
    weighIns: s.weighIns.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  }))
}

/** Delete a weigh-in; returns it for undo. */
export function deleteWeighIn(id: string): WeighIn | undefined {
  const w = fitStore.get().weighIns.find((x) => x.id === id)
  fitStore.set((s) => ({
    ...s,
    weighIns: s.weighIns.filter((x) => x.id !== id),
  }))
  return w
}

/** Undo for deleteWeighIn. */
export function restoreWeighIn(w: WeighIn) {
  fitStore.set((s) => ({ ...s, weighIns: [...s.weighIns, w] }))
}

// ── Nutrition ──

function scaleItem(it: MealItem, qty: number): MealItem {
  const f = it.qty > 0 ? qty / it.qty : 1
  return {
    ...it,
    qty,
    kcal: Math.round(it.kcal * f),
    protein: Math.round(it.protein * f),
    carbs: Math.round(it.carbs * f),
    fat: Math.round(it.fat * f),
  }
}

const WORD_NUM: Record<string, number> = {
  half: 0.5,
  kalahati: 0.5,
  one: 1,
  isang: 1,
  two: 2,
  dalawang: 2,
  three: 3,
  tatlong: 3,
}

/**
 * Scripted "AI" estimate (ADR-0009: AI is simulated). Matches the PH food
 * library; returns null when nothing is recognised (→ FIT-16 error state).
 */
export function parseMealText(raw: string): {
  items: MealItem[]
  confidence: number
  followUp?: Meal["followUp"]
} | null {
  // "-silog" combos = viand + sinangag + itlog
  const text = raw
    .toLowerCase()
    .replace(/tapsilog/g, "tapa, garlic rice, egg")
    .replace(/longsilog/g, "longganisa, garlic rice, egg")
    .replace(/tocilog/g, "tocino, garlic rice, egg")
    .replace(/bangsilog/g, "bangus, garlic rice, egg")
  const items: MealItem[] = []
  const used = new Set<string>()
  // longer aliases first so "garlic rice" wins over "rice"
  const aliases = FOODS.flatMap((f) => f.aliases.map((a) => ({ a, f }))).sort(
    (x, y) => y.a.length - x.a.length,
  )
  let rest = text
  for (const { a, f } of aliases) {
    const i = rest.indexOf(a)
    if (i < 0 || used.has(f.key)) continue
    used.add(f.key)
    const before = rest.slice(Math.max(0, i - 14), i)
    const num = before.match(
      /(\d+(?:\.\d+)?)\s*(?:x|pcs?|cups?|scoops?|g|bowls?|plates?|cans?)?\s*(?:na|of)?\s*$/,
    )
    const word = before.match(
      /(half|kalahati|one|isang|two|dalawang|three|tatlong)\s*(?:cups?|na|of)?\s*$/,
    )
    let mult = 1
    const qtyGiven = num ? Number(num[1]) : word ? WORD_NUM[word[1]] : undefined
    if (qtyGiven !== undefined)
      mult =
        f.unit === "g"
          ? qtyGiven > 20
            ? qtyGiven / f.qty
            : qtyGiven
          : qtyGiven / f.qty
    items.push(itemFromFood(f, Math.max(0.25, mult)))
    rest = rest.slice(0, i) + " ".repeat(a.length) + rest.slice(i + a.length)
  }
  if (!items.length) return null
  const riceGiven = /\d|half|isang|kalahati/.test(text)
  const hasRice = used.has("rice") || used.has("garlic-rice")
  return {
    items,
    confidence: Math.min(0.92, 0.6 + items.length * 0.08),
    followUp:
      hasRice && !riceGiven
        ? {
            question: "How much rice?",
            options: ["1 cup", "1.5 cups", "2 cups"],
          }
        : undefined,
  }
}

/**
 * Create an AI-estimated meal from text/voice/photo hint (status "estimated",
 * awaiting confirm in FIT-16). Returns null when the input can't be estimated.
 */
export function estimateMeal(
  raw: string,
  opts: {
    source?: MealSource
    photo?: boolean
    eatenAt?: string
    label?: MealLabel
  } = {},
): Meal | null {
  const parsed = parseMealText(raw)
  if (!parsed) return null
  const eatenAt = opts.eatenAt ?? now()
  const meal: Meal = {
    id: uid(),
    eatenAt,
    label: opts.label ?? labelForTime(new Date(eatenAt)),
    source: opts.source ?? "text",
    photo: opts.photo,
    rawInput: raw,
    status: "estimated",
    confidence: opts.photo ? parsed.confidence - 0.08 : parsed.confidence,
    items: parsed.items,
    followUp: parsed.followUp,
  }
  fitStore.set((s) => ({ ...s, meals: [...s.meals, meal] }))
  return meal
}

/** Offline photo: queue as pending_estimate (doesn't count toward macros yet). */
export function queueMealPhoto(hint = "", eatenAt?: string): Meal {
  const at = eatenAt ?? now()
  const meal: Meal = {
    id: uid(),
    eatenAt: at,
    label: labelForTime(new Date(at)),
    source: "photo",
    photo: true,
    rawInput: hint ? `Photo · “${hint}”` : "Photo",
    status: "pending_estimate",
    items: [],
  }
  fitStore.set((s) => ({ ...s, meals: [...s.meals, meal] }))
  return meal
}

/** Run a queued estimate now (simulated: typical PH plate unless a hint parses). */
export function runPendingEstimate(id: string): Meal | undefined {
  const m = fitStore.get().meals.find((x) => x.id === id)
  if (!m) return
  const parsed = parseMealText(m.rawInput) ?? {
    items: [
      itemFromFood(FOODS.find((f) => f.key === "turon") as Food),
      itemFromFood(FOODS.find((f) => f.key === "coffee") as Food),
    ],
    confidence: 0.64,
    followUp: undefined,
  }
  updateMeal(id, {
    status: "estimated",
    items: parsed.items,
    confidence: parsed.confidence,
    followUp: parsed.followUp,
  })
  return fitStore.get().meals.find((x) => x.id === id)
}

/** Log a manual meal (confirmed immediately). */
export function logMeal(input: {
  items: Omit<MealItem, "id">[]
  eatenAt?: string
  label?: MealLabel
  source?: MealSource
  rawInput?: string
}): Meal {
  const eatenAt = input.eatenAt ?? now()
  const meal: Meal = {
    id: uid(),
    eatenAt,
    label: input.label ?? labelForTime(new Date(eatenAt)),
    source: input.source ?? "manual",
    rawInput: input.rawInput ?? input.items.map((i) => i.name).join(", "),
    status: "confirmed",
    items: input.items.map((i) => ({ ...i, id: uid() })),
  }
  fitStore.set((s) => ({ ...s, meals: [...s.meals, meal] }))
  return meal
}

/** Patch meal fields (time, label, items, status…). */
export function updateMeal(id: string, patch: Partial<Omit<Meal, "id">>) {
  fitStore.set((s) => ({
    ...s,
    meals: s.meals.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  }))
}

/** 1 tap: accept the estimate. */
export function confirmMeal(id: string) {
  updateMeal(id, { status: "confirmed", followUp: undefined })
}

/** Change an item's quantity; macros scale proportionally. */
export function setMealItemQty(mealId: string, itemId: string, qty: number) {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  if (!m) return
  updateMeal(mealId, {
    items: m.items.map((it) =>
      it.id === itemId ? scaleItem(it, Math.max(0, qty)) : it,
    ),
  })
}

/** Overwrite an item's macros. */
export function setMealItemMacros(
  mealId: string,
  itemId: string,
  macros: Partial<Macros & { name: string }>,
) {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  if (!m) return
  updateMeal(mealId, {
    items: m.items.map((it) => (it.id === itemId ? { ...it, ...macros } : it)),
  })
}

/** Add an item (from the food library key, or custom). */
export function addMealItem(
  mealId: string,
  item: string | Omit<MealItem, "id">,
): MealItem | undefined {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  if (!m) return
  const f =
    typeof item === "string" ? FOODS.find((x) => x.key === item) : undefined
  const it: MealItem = f
    ? itemFromFood(f)
    : { ...(item as Omit<MealItem, "id">), id: uid() }
  updateMeal(mealId, { items: [...m.items, it] })
  return it
}

/** Remove an item from a meal. */
export function removeMealItem(mealId: string, itemId: string) {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  if (!m) return
  updateMeal(mealId, { items: m.items.filter((i) => i.id !== itemId) })
}

/** Answer the AI's single follow-up (rice size) — rescales the rice item. */
export function answerFollowUp(mealId: string, option: string) {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  if (!m) return
  const cups = Number.parseFloat(option) || 1
  updateMeal(mealId, {
    followUp: undefined,
    confidence: Math.min(0.95, (m.confidence ?? 0.7) + 0.1),
    items: m.items.map((it) =>
      /rice/i.test(it.name)
        ? { ...scaleItem(it, cups), assumption: `${option}, you said` }
        : it,
    ),
  })
}

/** Re-run the estimate with an extra hint; keeps the meal id. */
export function reestimateMeal(mealId: string, hint: string): boolean {
  const m = fitStore.get().meals.find((x) => x.id === mealId)
  const parsed = parseMealText(hint)
  if (!m || !parsed) return false
  updateMeal(mealId, {
    status: "estimated",
    items: parsed.items,
    confidence: parsed.confidence,
    followUp: parsed.followUp,
    rawInput: `${m.rawInput} · “${hint}”`,
  })
  return true
}

/** Delete a meal; returns it for undo. */
export function deleteMeal(id: string): Meal | undefined {
  const m = fitStore.get().meals.find((x) => x.id === id)
  fitStore.set((s) => ({ ...s, meals: s.meals.filter((x) => x.id !== id) }))
  return m
}

/** Undo for deleteMeal. */
export function restoreMeal(m: Meal) {
  fitStore.set((s) => ({ ...s, meals: [...s.meals, m] }))
}

/** Re-log a past meal on `day` (default today) at the current time. */
export function duplicateMeal(id: string, day = dayKey()): Meal | undefined {
  const m = fitStore.get().meals.find((x) => x.id === id)
  if (!m) return
  const t = new Date()
  const d = new Date(`${day}T00:00:00`)
  d.setHours(t.getHours(), t.getMinutes())
  const copy: Meal = {
    ...m,
    id: uid(),
    eatenAt: d.toISOString(),
    status: "confirmed",
    followUp: undefined,
    items: m.items.map((i) => ({ ...i, id: uid() })),
  }
  fitStore.set((s) => ({ ...s, meals: [...s.meals, copy] }))
  return copy
}

/** Set macro targets effective from today (past days keep the old target). */
export function setMacroTarget(m: Macros): MacroTarget {
  const today = dayKey()
  const t: MacroTarget = { ...m, id: uid(), effectiveFrom: today }
  fitStore.set((s) => ({
    ...s,
    targets: [...s.targets.filter((x) => x.effectiveFrom !== today), t],
  }))
  return t
}

/** Update fitness settings. */
export function updateSettings(patch: Partial<FitnessSettings>) {
  fitStore.set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}

/** Restore the seeded demo data for fitness only. */
export function resetFitness() {
  if (liveStore.get().live?.kind === "workout") stopLive()
  fitStore.reset()
}

/** Current target for today (used by Capture's "how much protein left?"). */
export function macrosLeftToday() {
  const s = fitStore.get()
  const t = targetFor(s, dayKey())
  const eaten = s.meals
    .filter(
      (m) =>
        dayKey(new Date(m.eatenAt)) === dayKey() &&
        m.status !== "pending_estimate",
    )
    .flatMap((m) => m.items)
  const sum = eaten.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      protein: a.protein + i.protein,
      carbs: a.carbs + i.carbs,
      fat: a.fat + i.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )
  return t
    ? {
        kcal: t.kcal - sum.kcal,
        protein: t.protein - sum.protein,
        carbs: t.carbs - sum.carbs,
        fat: t.fat - sum.fat,
      }
    : null
}
