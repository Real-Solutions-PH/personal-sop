// Fitness mappers: the prototype fitness store against the server's
// exercise, workout_template, template_item, workout, workout_exercise,
// workout_set, weigh_in, macro_target, meal, meal_item, fitness_settings and
// rest_timer entities. Weights are kilograms on both sides (`units` is a
// display setting only).
//
// Nested arrays become child rows:
//   - a template's `items` are template_item slots: id derivedId
//     ("template-item", template, position), exactly the server's own
//     `_put_template`, so editing slot i rewrites the same row;
//   - a workout's `exercises` are workout_exercise rows. The server keeps a
//     unique (workout, position) slot that a tombstone still holds, so a row
//     keeps the position it was synced with (a hidden `position` on the
//     local object) and a new or moved row takes a FRESH position above the
//     highest the device has seen for that workout (hidden `posHigh`).
//     Positions only grow, so two writes never claim one slot;
//   - a workout's sets and a meal's items use their index as the position
//     (no unique slot on the server).
//
// Status changes are actions, never field writes:
//   - a new in-progress workout -> fitness.start_workout with source
//     "empty" and the device's workout id; the exercises and sets the device
//     planned follow as ordinary creates. (Starting from the template would
//     have the server plan its own sets from its own history, which can
//     differ from the device's by a warm-up and leave extra rows.)
//   - in progress -> finished: fitness.finish_workout with the device's end
//     time; `unfinished` is "done" when the finish ticked the open sets;
//   - an in-progress workout removed: fitness.discard_workout (the delete op
//     that follows is a no-op on the discarded row);
//   - a set ticked or unticked while its workout is in progress:
//     fitness.toggle_set (it starts the rest timer and relabels the Live
//     bar). completed_at is left out of a live workout's set payloads, and
//     is an ordinary field outside one (a finished or chat-logged workout),
//     so a logged workout's sets keep their times on create;
//   - a meal confirmed: fitness.confirm_meal; a follow-up answered:
//     fitness.answer_follow_up with the option the device recorded in the
//     rice item's assumption. The rescaled items still follow as field
//     writes, with the same values the action computes;
//   - the rest timer: fitness.rest.start / adjust / skip. rest_timer is
//     written only by those actions (the server registers it read-only), so
//     its mapper is actionsOnly: the one constant row it lists never becomes
//     a field write, which the server would refuse as unknown_entity.
//
// Children pulled before their parent (a later page of the same pull) are
// held here and attached when the parent arrives; they are then pushed once
// as an unchanged write, which the server applies as a no-op edit.

import type {
  Exercise,
  FitnessSettings,
  FitnessState,
  MacroTarget,
  Meal,
  MealItem,
  RestTimer,
  WeighIn,
  Workout,
  WorkoutExercise,
  WorkoutSet,
  WorkoutTemplate,
} from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { derivedId } from "@domain/lib/ids"
import type { ActionOp, Mapper, Payload } from "../mapper"
import { singleton } from "./helpers"

type S = FitnessState

// ---------------------------------------------------------------- shapes

const str = (v: unknown) => String(v)
const optStr = (v: unknown) => (v == null || v === "" ? undefined : String(v))
/** One instant format locally, whatever offset the server renders. */
const instant = (v: unknown) => new Date(String(v)).toISOString()
const optInstant = (v: unknown) => (v == null ? undefined : instant(v))
const pick = <T extends string>(v: unknown, allowed: readonly T[], or: T) =>
  allowed.includes(v as T) ? (v as T) : or

/** A workout as the device holds it once synced. */
export type SyncedWorkout = Workout & {
  /** The cardio part of a workout logged from chat (server-written). */
  cardio?: Record<string, unknown>
  /** Highest workout_exercise position seen for this workout. */
  posHigh?: number
}
/** A workout exercise as the device holds it once synced. */
export type SyncedExercise = WorkoutExercise & { position?: number }

/** Children pulled before their parent, keyed by parent id. */
function orphans<T extends { id: string }>() {
  const byParent = new Map<string, Map<string, T>>()
  return {
    hold(parent: string, row: T) {
      const m = byParent.get(parent) ?? new Map<string, T>()
      m.set(row.id, row)
      byParent.set(parent, m)
    },
    drop(id: string) {
      for (const m of byParent.values()) m.delete(id)
    },
    take(parent: string): T[] {
      const m = byParent.get(parent)
      byParent.delete(parent)
      return m ? [...m.values()] : []
    },
  }
}
type Held<T extends { id: string }> = ReturnType<typeof orphans<T>>

/** Upsert by id (pulled rows win, in place), new rows last, deletes dropped. */
function mergeById<T>(
  list: T[],
  ups: T[],
  dels: string[],
  id: (t: T) => string,
): T[] {
  const gone = new Set(dels)
  const byId = new Map(ups.map((u) => [id(u), u]))
  const out: T[] = []
  for (const t of list) {
    if (gone.has(id(t))) continue
    const u = byId.get(id(t))
    out.push(u ?? t)
    byId.delete(id(t))
  }
  return [...out, ...byId.values()]
}

const byTime =
  <T>(key: (t: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0

// ---------------------------------------------------------------- exercise

export function exerciseMapper(): Mapper<S, Exercise> {
  return {
    entity: "exercise",
    store: fitStore,
    list: (s) => s.exercises,
    id: (e) => e.id,
    toServer: (e) => ({
      name: e.name,
      equipment: e.equipment,
      muscle: e.muscle,
      load_type: e.loadType,
      rep_min: e.repMin,
      rep_max: e.repMax,
      increment: e.increment,
      archived: e.archived ?? false,
    }),
    fromServer: (row) => ({
      id: str(row.id),
      name: str(row.name),
      equipment: row.equipment as Exercise["equipment"],
      muscle: row.muscle as Exercise["muscle"],
      loadType: row.load_type as Exercise["loadType"],
      repMin: Number(row.rep_min),
      repMax: Number(row.rep_max),
      increment: Number(row.increment),
      ...(row.archived ? { archived: true } : {}),
    }),
    merge: (s, ups, dels) =>
      ups.length || dels.length
        ? { ...s, exercises: mergeById(s.exercises, ups, dels, (e) => e.id) }
        : s,
  }
}

// ---------------------------------------------------------------- templates

interface ItemRow {
  id: string
  templateId: string
  position: number
  exerciseId: string
  sets: number
}

export const templateItemId = (templateId: string, position: number) =>
  derivedId("template-item", templateId, String(position))

type SortedTemplate = WorkoutTemplate & { sortOrder?: number }

export function templateMapper(
  held: Held<ItemRow>,
): Mapper<S, WorkoutTemplate> {
  return {
    entity: "workout_template",
    store: fitStore,
    list: (s) => s.templates,
    id: (t) => t.id,
    toServer: (t, s) => ({
      name: t.name,
      sort_order: s.templates.findIndex((x) => x.id === t.id),
    }),
    fromServer: (row, s) => {
      const id = str(row.id)
      const cur = s.templates.find((t) => t.id === id)
      return {
        id,
        name: str(row.name),
        items: cur?.items ?? [],
        sortOrder: Number(row.sort_order ?? 0),
      } as SortedTemplate
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.templates.map((t) => t.id))
      const fresh = ups
        .filter((t) => !known.has(t.id))
        .sort(
          (a: SortedTemplate, b: SortedTemplate) =>
            (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
        )
        .map((t) => ({ ...t, items: placeItems([], held.take(t.id)) }))
      const strip = ({ sortOrder: _, ...t }: SortedTemplate) => t
      return {
        ...s,
        templates: mergeById(
          s.templates,
          [...ups.filter((t) => known.has(t.id)), ...fresh],
          dels,
          (t) => t.id,
        ).map(strip),
      }
    },
  }
}

/** Write pulled slots into a template's items (slot = position). */
function placeItems(items: WorkoutTemplate["items"], rows: ItemRow[]) {
  const out = [...items]
  for (const r of [...rows].sort((a, b) => a.position - b.position)) {
    const it = { exerciseId: r.exerciseId, sets: r.sets }
    if (r.position < out.length) out[r.position] = it
    else out.push(it)
  }
  return out
}

export function templateItemMapper(held: Held<ItemRow>): Mapper<S, ItemRow> {
  return {
    entity: "template_item",
    store: fitStore,
    list: (s) =>
      s.templates.flatMap((t) =>
        t.items.map((it, i) => ({
          id: templateItemId(t.id, i),
          templateId: t.id,
          position: i,
          exerciseId: it.exerciseId,
          sets: it.sets,
        })),
      ),
    id: (r) => r.id,
    toServer: (r) => ({
      template_id: r.templateId,
      exercise_id: r.exerciseId,
      position: r.position,
      sets: r.sets,
    }),
    fromServer: (row, s) => {
      const r: ItemRow = {
        id: str(row.id),
        templateId: str(row.template_id),
        position: Number(row.position),
        exerciseId: str(row.exercise_id),
        sets: Number(row.sets),
      }
      if (s.templates.some((t) => t.id === r.templateId)) return r
      held.hold(r.templateId, r)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        templates: s.templates.map((t) => {
          const mine = ups.filter((u) => u.templateId === t.id)
          const kept = t.items.filter(
            (_, i) => !gone.has(templateItemId(t.id, i)),
          )
          if (!mine.length && kept.length === t.items.length) return t
          return { ...t, items: placeItems(kept, mine) }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- workouts

const STATUSES = ["in_progress", "finished"] as const

/** Where each exercise of a workout sits on the server (see the header). */
export function exercisePositions(w: SyncedWorkout): Map<string, number> {
  const exs = w.exercises as SyncedExercise[]
  let high = w.posHigh ?? -1
  for (const e of exs)
    if (e.position !== undefined) high = Math.max(high, e.position)
  const out = new Map<string, number>()
  let last = Number.NEGATIVE_INFINITY
  for (const e of exs) {
    const p =
      e.position !== undefined && e.position > last ? e.position : ++high
    out.set(e.id, p)
    last = p
  }
  return out
}

/** The option a follow-up answer wrote into the rice items' assumption. */
function answeredOption(prev: Meal, next: Meal): string | undefined {
  const before = new Map(prev.items.map((i) => [i.id, i.assumption]))
  for (const it of next.items) {
    const m = it.assumption?.match(/^(.+), you said$/)
    if (m && before.get(it.id) !== it.assumption) return m[1]
  }
  return undefined
}

export function workoutMapper(
  held: Held<ExRow>,
  setsHeld: Held<SetRow>,
): Mapper<S, SyncedWorkout> {
  return {
    entity: "workout",
    store: fitStore,
    list: (s) => s.workouts,
    id: (w) => w.id,
    toServer: (w) => ({
      name: w.name,
      template_id: w.templateId ?? null,
      started_at: w.startedAt,
      ended_at: w.endedAt ?? null,
      status: w.status,
      notes: w.notes ?? null,
      source: w.source ?? "live",
    }),
    fromServer: (row, s) => {
      const status = row.status as Workout["status"]
      if (!STATUSES.includes(status as (typeof STATUSES)[number])) return null
      const id = str(row.id)
      const cur = s.workouts.find((w) => w.id === id) as
        | SyncedWorkout
        | undefined
      return {
        id,
        name: str(row.name),
        templateId: optStr(row.template_id),
        startedAt: instant(row.started_at),
        endedAt: optInstant(row.ended_at),
        status,
        notes: optStr(row.notes),
        exercises: cur?.exercises ?? [],
        clientId: cur?.clientId ?? id,
        source: row.source === "chat" ? "chat" : "live",
        ...(row.cardio
          ? { cardio: row.cardio as Record<string, unknown> }
          : {}),
        ...(cur?.posHigh !== undefined ? { posHigh: cur.posHigh } : {}),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.workouts.map((w) => w.id))
      const attached = ups.map((w) =>
        known.has(w.id) ? w : withExercises(w, held.take(w.id), setsHeld),
      )
      const workouts = mergeById(s.workouts, attached, dels, (w) => w.id).sort(
        byTime((w) => w.startedAt),
      )
      const active = workouts.find((w) => w.id === s.activeId)
      const activeId =
        active?.status === "in_progress"
          ? active.id
          : (workouts.find((w) => w.status === "in_progress")?.id ?? null)
      return { ...s, workouts, activeId }
    },
    actionFields: ["status"],
    actions: (prev, next) => {
      const ops: ActionOp[] = []
      if (!prev && next?.status === "in_progress")
        ops.push({
          name: "fitness.start_workout",
          data: { source: "empty", workout_id: next.id },
        })
      else if (prev?.status === "in_progress" && next?.status === "finished") {
        const before = new Map(
          prev.exercises.flatMap((e) => e.sets.map((x) => [x.id, x])),
        )
        const ticked = next.exercises.some((e) =>
          e.sets.some(
            (x) =>
              x.completedAt === next.endedAt && !before.get(x.id)?.completedAt,
          ),
        )
        ops.push({
          name: "fitness.finish_workout",
          data: {
            workout_id: next.id,
            unfinished: ticked ? "done" : "remove",
            end_at: next.endedAt ?? null,
          },
        })
      } else if (prev?.status === "in_progress" && !next)
        ops.push({
          name: "fitness.discard_workout",
          data: { workout_id: prev.id },
        })
      return ops
    },
  }
}

// ---------------------------------------------------------------- workout exercise

interface ExRow {
  id: string
  workoutId: string
  exerciseId: string
  position: number
  note?: string
}

function withExercises(
  w: SyncedWorkout,
  rows: ExRow[],
  setsHeld: Held<SetRow>,
): SyncedWorkout {
  if (!rows.length) return w
  const exs = w.exercises as SyncedExercise[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  let reorder = false
  const out: SyncedExercise[] = exs.map((e) => {
    const r = byId.get(e.id)
    if (!r) return e
    byId.delete(e.id)
    if (r.position !== e.position) reorder = true
    return {
      ...e,
      exerciseId: r.exerciseId,
      note: r.note,
      position: r.position,
    }
  })
  for (const r of byId.values()) {
    reorder = true
    out.push({
      id: r.id,
      exerciseId: r.exerciseId,
      note: r.note,
      position: r.position,
      sets: setsHeld
        .take(r.id)
        .sort((a, b) => a.position - b.position)
        .map(toSet),
    })
  }
  if (reorder)
    out.sort(
      (a, b) =>
        (a.position ?? Number.POSITIVE_INFINITY) -
        (b.position ?? Number.POSITIVE_INFINITY),
    )
  const posHigh = Math.max(w.posHigh ?? -1, ...rows.map((r) => r.position))
  return { ...w, exercises: out, posHigh }
}

export function workoutExerciseMapper(
  held: Held<ExRow>,
  setsHeld: Held<SetRow>,
): Mapper<S, ExRow> {
  return {
    entity: "workout_exercise",
    store: fitStore,
    list: (s) =>
      s.workouts.flatMap((w) => {
        const pos = exercisePositions(w)
        return w.exercises.map((e) => ({
          id: e.id,
          workoutId: w.id,
          exerciseId: e.exerciseId,
          position: pos.get(e.id) as number,
          note: e.note,
        }))
      }),
    id: (r) => r.id,
    toServer: (r) => ({
      workout_id: r.workoutId,
      exercise_id: r.exerciseId,
      position: r.position,
      note: r.note || null,
    }),
    fromServer: (row, s) => {
      const r: ExRow = {
        id: str(row.id),
        workoutId: str(row.workout_id),
        exerciseId: str(row.exercise_id),
        position: Number(row.position),
        note: optStr(row.note),
      }
      if (s.workouts.some((w) => w.id === r.workoutId)) return r
      held.hold(r.workoutId, r)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        workouts: s.workouts.map((w: SyncedWorkout) => {
          const mine = ups.filter((u) => u.workoutId === w.id)
          const removed = (w.exercises as SyncedExercise[]).filter((e) =>
            gone.has(e.id),
          )
          if (!mine.length && !removed.length) return w
          const posHigh = Math.max(
            w.posHigh ?? -1,
            ...removed.map((e) => e.position ?? -1),
          )
          return withExercises(
            {
              ...w,
              posHigh,
              exercises: w.exercises.filter((e) => !gone.has(e.id)),
            },
            mine,
            setsHeld,
          )
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- workout set

interface SetRow {
  id: string
  workoutId: string
  weId: string
  position: number
  reps: number
  weight: number
  kind: WorkoutSet["kind"]
  completedAt?: string
  /** Its workout is in progress (ticks go through fitness.toggle_set). */
  live: boolean
}

const toSet = (r: SetRow): WorkoutSet => ({
  id: r.id,
  reps: r.reps,
  weight: r.weight,
  kind: r.kind,
  ...(r.completedAt ? { completedAt: r.completedAt } : {}),
})

const SET_KINDS = ["warmup", "working", "drop", "failure"] as const

export function workoutSetMapper(setsHeld: Held<SetRow>): Mapper<S, SetRow> {
  return {
    entity: "workout_set",
    store: fitStore,
    list: (s) =>
      s.workouts.flatMap((w) =>
        w.exercises.flatMap((e) =>
          e.sets.map((x, i) => ({
            id: x.id,
            workoutId: w.id,
            weId: e.id,
            position: i,
            reps: x.reps,
            weight: x.weight,
            kind: x.kind,
            completedAt: x.completedAt,
            live: w.status === "in_progress",
          })),
        ),
      ),
    id: (r) => r.id,
    toServer: (r) => ({
      workout_exercise_id: r.weId,
      position: r.position,
      reps: r.reps,
      weight: r.weight,
      kind: r.kind,
      ...(r.live ? {} : { completed_at: r.completedAt ?? null }),
    }),
    fromServer: (row, s) => {
      const weId = str(row.workout_exercise_id)
      const w = s.workouts.find((x) => x.exercises.some((e) => e.id === weId))
      const r: SetRow = {
        id: str(row.id),
        workoutId: w?.id ?? "",
        weId,
        position: Number(row.position),
        reps: Number(row.reps),
        weight: Number(row.weight),
        kind: pick(row.kind, SET_KINDS, "working"),
        completedAt: optInstant(row.completed_at),
        live: w?.status === "in_progress",
      }
      if (w) return r
      setsHeld.hold(weId, r)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) setsHeld.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        workouts: s.workouts.map((w) => {
          if (
            !ups.some((u) => u.workoutId === w.id) &&
            !w.exercises.some((e) => e.sets.some((x) => gone.has(x.id)))
          )
            return w
          return {
            ...w,
            exercises: w.exercises.map((e) => {
              const mine = ups.filter((u) => u.weId === e.id)
              const sets = e.sets.filter((x) => !gone.has(x.id))
              if (!mine.length && sets.length === e.sets.length) return e
              return { ...e, sets: placeRows(sets, mine, toSet) }
            }),
          }
        }),
      }
    },
    actions: (prev, next) =>
      prev?.live &&
      next?.live &&
      Boolean(prev.completedAt) !== Boolean(next.completedAt)
        ? [
            {
              name: "fitness.toggle_set",
              data: {
                workout_id: next.workoutId,
                workout_exercise_id: next.weId,
                set_id: next.id,
              },
            },
          ]
        : [],
  }
}

/** Replace pulled rows in place; insert new ones at their position. */
function placeRows<
  T extends { id: string },
  R extends { id: string; position: number },
>(list: T[], rows: R[], to: (r: R) => T): T[] {
  const out = [...list]
  const fresh: R[] = []
  for (const r of rows) {
    const i = out.findIndex((t) => t.id === r.id)
    if (i >= 0) out[i] = to(r)
    else fresh.push(r)
  }
  for (const r of fresh.sort((a, b) => a.position - b.position))
    out.splice(Math.min(r.position, out.length), 0, to(r))
  return out
}

// ---------------------------------------------------------------- weigh-ins

export function weighInMapper(): Mapper<S, WeighIn> {
  return {
    entity: "weigh_in",
    store: fitStore,
    list: (s) => s.weighIns,
    id: (w) => w.id,
    toServer: (w) => ({
      measured_at: w.measuredAt,
      weight_kg: w.weightKg,
      body_fat_pct: w.bodyFatPct ?? null,
      note: w.note ?? null,
    }),
    fromServer: (row) => ({
      id: str(row.id),
      measuredAt: instant(row.measured_at),
      weightKg: Number(row.weight_kg),
      ...(row.body_fat_pct != null
        ? { bodyFatPct: Number(row.body_fat_pct) }
        : {}),
      ...(row.note != null ? { note: str(row.note) } : {}),
    }),
    merge: (s, ups, dels) =>
      ups.length || dels.length
        ? {
            ...s,
            weighIns: mergeById(s.weighIns, ups, dels, (w) => w.id).sort(
              byTime((w) => w.measuredAt),
            ),
          }
        : s,
  }
}

// ---------------------------------------------------------------- macro targets

export function macroTargetMapper(): Mapper<S, MacroTarget> {
  return {
    entity: "macro_target",
    store: fitStore,
    list: (s) => s.targets,
    id: (t) => t.id,
    toServer: (t) => ({
      effective_from: t.effectiveFrom,
      kcal: t.kcal,
      protein: t.protein,
      carbs: t.carbs,
      fat: t.fat,
    }),
    fromServer: (row) => ({
      id: str(row.id),
      effectiveFrom: str(row.effective_from),
      kcal: Number(row.kcal),
      protein: Number(row.protein),
      carbs: Number(row.carbs),
      fat: Number(row.fat),
    }),
    // One target per day: a pulled row replaces a local row for the same
    // day under another id (the server's upsert reuses its row by day).
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const pulled = new Map(ups.map((u) => [u.effectiveFrom, u.id]))
      const kept = s.targets.filter((t) => {
        const winner = pulled.get(t.effectiveFrom)
        return winner === undefined || winner === t.id
      })
      return {
        ...s,
        targets: mergeById(kept, ups, dels, (t) => t.id).sort(
          byTime((t) => t.effectiveFrom),
        ),
      }
    },
  }
}

// ---------------------------------------------------------------- meals

const MEAL_LABELS = ["breakfast", "lunch", "dinner", "snack"] as const
const MEAL_SOURCES = ["photo", "voice", "text", "manual", "connector"] as const
const MEAL_STATUSES = ["pending_estimate", "estimated", "confirmed"] as const

function followUpIn(v: unknown): Meal["followUp"] {
  if (!v || typeof v !== "object") return undefined
  const f = v as { question?: unknown; options?: unknown }
  return {
    question: str(f.question ?? ""),
    options: Array.isArray(f.options) ? f.options.map(str) : [],
  }
}

export function mealMapper(held: Held<ItemRowM>): Mapper<S, Meal> {
  return {
    entity: "meal",
    store: fitStore,
    list: (s) => s.meals,
    id: (m) => m.id,
    toServer: (m) => ({
      eaten_at: m.eatenAt,
      label: m.label,
      source: m.source,
      raw_input: m.rawInput,
      status: m.status,
      confidence: m.confidence ?? null,
      follow_up: m.followUp
        ? { question: m.followUp.question, options: m.followUp.options }
        : null,
    }),
    fromServer: (row, s) => {
      const id = str(row.id)
      const cur = s.meals.find((m) => m.id === id)
      const source = pick(row.source, MEAL_SOURCES, "manual")
      const followUp = followUpIn(row.follow_up)
      return {
        id,
        eatenAt: instant(row.eaten_at),
        label: pick(row.label, MEAL_LABELS, "snack"),
        source,
        photo:
          row.photo_media_id != null || source === "photo"
            ? true
            : (cur?.photo ?? false),
        rawInput: str(row.raw_input ?? ""),
        status: pick(row.status, MEAL_STATUSES, "estimated"),
        ...(row.confidence != null
          ? { confidence: Number(row.confidence) }
          : {}),
        items: cur?.items ?? [],
        ...(followUp ? { followUp } : {}),
      }
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      const known = new Set(s.meals.map((m) => m.id))
      const attached = ups.map((m) =>
        known.has(m.id)
          ? m
          : { ...m, items: placeRows([], held.take(m.id), toItem) },
      )
      return {
        ...s,
        meals: mergeById(s.meals, attached, dels, (m) => m.id).sort(
          byTime((m) => m.eatenAt),
        ),
      }
    },
    actions: (prev, next) => {
      if (!prev || !next) return []
      if (prev.status !== "confirmed" && next.status === "confirmed")
        return [{ name: "fitness.confirm_meal", data: { meal_id: next.id } }]
      if (prev.followUp && !next.followUp) {
        const option = answeredOption(prev, next)
        if (option)
          return [
            {
              name: "fitness.answer_follow_up",
              data: { meal_id: next.id, option: option.slice(0, 40) },
            },
          ]
      }
      return []
    },
  }
}

// ---------------------------------------------------------------- meal items

interface ItemRowM extends MealItem {
  mealId: string
  position: number
}

const toItem = ({ mealId: _, position: __, ...it }: ItemRowM): MealItem => it

export function mealItemMapper(held: Held<ItemRowM>): Mapper<S, ItemRowM> {
  return {
    entity: "meal_item",
    store: fitStore,
    list: (s) =>
      s.meals.flatMap((m) =>
        m.items.map((it, i) => ({ ...it, mealId: m.id, position: i })),
      ),
    id: (r) => r.id,
    toServer: (r) => ({
      meal_id: r.mealId,
      position: r.position,
      name: r.name,
      qty: r.qty,
      unit: r.unit,
      kcal: r.kcal,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      assumption: r.assumption ?? null,
      fiber: r.fiber ?? null,
      sat_fat: r.satFat ?? null,
      sugar: r.sugar ?? null,
      sodium: r.sodium ?? null,
    }),
    fromServer: (row, s) => {
      const r: ItemRowM = {
        id: str(row.id),
        mealId: str(row.meal_id),
        position: Number(row.position),
        name: str(row.name),
        qty: Number(row.qty),
        unit: str(row.unit),
        kcal: Number(row.kcal),
        protein: Number(row.protein),
        carbs: Number(row.carbs),
        fat: Number(row.fat),
        ...(row.assumption != null ? { assumption: str(row.assumption) } : {}),
        ...(row.fiber != null ? { fiber: Number(row.fiber) } : {}),
        ...(row.sat_fat != null ? { satFat: Number(row.sat_fat) } : {}),
        ...(row.sugar != null ? { sugar: Number(row.sugar) } : {}),
        ...(row.sodium != null ? { sodium: Number(row.sodium) } : {}),
      }
      if (s.meals.some((m) => m.id === r.mealId)) return r
      held.hold(r.mealId, r)
      return null
    },
    merge: (s, ups, dels) => {
      if (!ups.length && !dels.length) return s
      for (const d of dels) held.drop(d)
      const gone = new Set(dels)
      return {
        ...s,
        meals: s.meals.map((m) => {
          const mine = ups.filter((u) => u.mealId === m.id)
          const items = m.items.filter((i) => !gone.has(i.id))
          if (!mine.length && items.length === m.items.length) return m
          return { ...m, items: placeRows(items, mine, toItem) }
        }),
      }
    },
  }
}

// ---------------------------------------------------------------- settings

export function settingsMapper(userId: string) {
  return singleton<S, FitnessSettings>({
    entity: "fitness_settings",
    userId,
    store: fitStore,
    read: (s) => s.settings,
    write: (s, settings) => ({ ...s, settings }),
    toServer: (v) => ({
      units: v.units,
      rest_sec: v.restSec,
      weekly_target: v.weeklyTarget,
      // HH:MM, or null with the reminder off (an empty time locally).
      weigh_in_reminder: v.weighInReminder || null,
      progression: v.progression,
      ai_source: v.aiSource,
      goal_direction: v.goalDirection,
      goal_weight: v.goalWeight ?? null,
    }),
    fromServer: (row: Payload, cur) => {
      const { goalWeight: _, ...rest } = cur
      return {
        ...rest,
        units: row.units === "lb" ? "lb" : "kg",
        restSec: Number(row.rest_sec),
        weeklyTarget: Number(row.weekly_target),
        weighInReminder: row.weigh_in_reminder
          ? str(row.weigh_in_reminder)
          : "",
        progression: row.progression === "linear" ? "linear" : "double",
        aiSource: row.ai_source === "connector" ? "connector" : "builtin",
        goalDirection: pick(
          row.goal_direction,
          ["cut", "maintain", "bulk"] as const,
          "maintain",
        ),
        ...(row.goal_weight != null
          ? { goalWeight: Number(row.goal_weight) }
          : {}),
      }
    },
  })
}

// ---------------------------------------------------------------- rest timer

interface RestRow {
  id: string
  rest: RestTimer | null
}

const MAX_REST = 900
const clampRest = (n: number) => Math.max(-MAX_REST, Math.min(MAX_REST, n))

export function restActions(
  prev: RestTimer | null,
  next: RestTimer | null,
): ActionOp[] {
  if (!prev && next)
    return [
      {
        name: "fitness.rest.start",
        data: { sec: Math.max(0, Math.min(MAX_REST, next.durationSec)) },
      },
    ]
  if (prev && !next) return [{ name: "fitness.rest.skip", data: {} }]
  if (!prev || !next) return []
  if (prev.endsAt === next.endsAt && prev.durationSec === next.durationSec)
    return []
  const moved = Math.round(
    (new Date(next.endsAt).getTime() - new Date(prev.endsAt).getTime()) / 1000,
  )
  if (moved === next.durationSec - prev.durationSec && moved !== 0)
    return [{ name: "fitness.rest.adjust", data: { delta: clampRest(moved) } }]
  // A new timer over a running one (another set ticked).
  return [
    {
      name: "fitness.rest.start",
      data: { sec: Math.max(0, Math.min(MAX_REST, next.durationSec)) },
    },
  ]
}

export function restMapper(userId: string): Mapper<S, RestRow> {
  const id = derivedId("singleton", userId, "rest_timer")
  return {
    entity: "rest_timer",
    store: fitStore,
    list: (s) => [{ id, rest: s.rest }],
    id: (r) => r.id,
    toServer: (r) => ({
      ends_at: r.rest?.endsAt ?? null,
      duration_sec: r.rest?.durationSec ?? null,
    }),
    fromServer: (row) => ({
      id,
      rest: {
        endsAt: instant(row.ends_at),
        durationSec: Number(row.duration_sec),
      },
    }),
    // One timer per user: any pulled delete clears it, whatever its id.
    merge: (s, ups, dels) =>
      ups.length
        ? { ...s, rest: ups[ups.length - 1].rest }
        : dels.length
          ? { ...s, rest: null }
          : s,
    actionFields: ["ends_at", "duration_sec"],
    actionsOnly: true,
    actions: (prev, next) =>
      restActions(prev?.rest ?? null, next?.rest ?? null),
  }
}

// ---------------------------------------------------------------- factory

/** Parents before children, so a new child's parent is created first. */
export const fitnessMappers = (userId: string) => {
  const items = orphans<ItemRow>()
  const exercises = orphans<ExRow>()
  const sets = orphans<SetRow>()
  const mealItems = orphans<ItemRowM>()
  return [
    exerciseMapper(),
    templateMapper(items),
    templateItemMapper(items),
    workoutMapper(exercises, sets),
    workoutExerciseMapper(exercises, sets),
    workoutSetMapper(sets),
    weighInMapper(),
    macroTargetMapper(),
    mealMapper(mealItems),
    mealItemMapper(mealItems),
    settingsMapper(userId),
    restMapper(userId),
  ]
}
