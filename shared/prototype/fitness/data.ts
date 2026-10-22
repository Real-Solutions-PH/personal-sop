import { at, dayKey } from "../lib/day"
import { newId } from "../lib/ids"
export type Equipment =
  | "barbell"
  | "dumbbell"
  | "machine"
  | "cable"
  | "bodyweight"
export type LoadType = "weight" | "bodyweight" | "reps" | "time"
export type Muscle =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "core"
export interface Exercise {
  id: string
  name: string
  equipment: Equipment
  muscle: Muscle
  loadType: LoadType
  repMin: number
  repMax: number
  increment: number
  archived?: boolean
}
export interface TemplateItem {
  exerciseId: string
  sets: number
}
export interface WorkoutTemplate {
  id: string
  name: string
  items: TemplateItem[]
}
export type SetKind = "warmup" | "working" | "drop" | "failure"
export interface WorkoutSet {
  id: string
  reps: number
  weight: number
  kind: SetKind
  completedAt?: string
}
export interface WorkoutExercise {
  id: string
  exerciseId: string
  note?: string
  sets: WorkoutSet[]
}
export type WorkoutStatus = "in_progress" | "finished" | "discarded"
export interface Workout {
  id: string
  name: string
  templateId?: string
  startedAt: string
  endedAt?: string
  status: WorkoutStatus
  notes?: string
  exercises: WorkoutExercise[]
  clientId: string
  source?: "live" | "chat"
}
export interface RestTimer {
  endsAt: string
  durationSec: number
}
export interface WeighIn {
  id: string
  measuredAt: string
  weightKg: number
  bodyFatPct?: number
  note?: string
}
export interface Macros {
  kcal: number
  protein: number
  carbs: number
  fat: number
}
/** The user's own daily limits and fiber goal; a key left out reads as
 * the WHO default (see ./limits). */
export interface NutrientLimits {
  satFatMax?: number
  sugarMax?: number
  sodiumMax?: number
  fiberGoal?: number
}
export interface MacroTarget extends Macros, NutrientLimits {
  id: string
  effectiveFrom: string
}
export type MealLabel = "breakfast" | "lunch" | "dinner" | "snack"
export type MealSource = "photo" | "voice" | "text" | "manual" | "connector"
export type MealStatus = "pending_estimate" | "estimated" | "confirmed"
export interface MealItem extends Macros {
  id: string
  name: string
  qty: number
  unit: string
  assumption?: string
  /** Optional detail: grams (sodium in milligrams); absent = unknown. */
  fiber?: number
  satFat?: number
  sugar?: number
  sodium?: number
}
export interface Meal {
  id: string
  eatenAt: string
  label: MealLabel
  source: MealSource
  photo?: boolean
  rawInput: string
  status: MealStatus
  confidence?: number
  items: MealItem[]
  followUp?: {
    question: string
    options: string[]
  }
}
export interface FitnessSettings {
  units: "kg" | "lb"
  restSec: number
  weeklyTarget: number
  weighInReminder: string
  progression: "double" | "linear"
  aiSource: "builtin" | "connector"
  goalDirection: "cut" | "maintain" | "bulk"
  goalWeight?: number
}
export interface FitnessState {
  exercises: Exercise[]
  templates: WorkoutTemplate[]
  workouts: Workout[]
  weighIns: WeighIn[]
  targets: MacroTarget[]
  meals: Meal[]
  settings: FitnessSettings
  activeId: string | null
  rest: RestTimer | null
}
export interface Food extends Macros {
  key: string
  name: string
  qty: number
  unit: string
  assumption: string
  aliases: string[]
}
export const FOODS: Food[] = [
  {
    key: "garlic-rice",
    name: "Garlic rice (sinangag)",
    qty: 1,
    unit: "cup",
    kcal: 280,
    protein: 5,
    carbs: 50,
    fat: 6,
    assumption: "~1 cup, 180 g",
    aliases: ["garlic rice", "sinangag"],
  },
  {
    key: "rice",
    name: "Steamed rice",
    qty: 1,
    unit: "cup",
    kcal: 205,
    protein: 4,
    carbs: 45,
    fat: 0,
    assumption: "~1 cup cooked, 160 g",
    aliases: ["rice", "kanin"],
  },
  {
    key: "tapa",
    name: "Beef tapa",
    qty: 100,
    unit: "g",
    kcal: 250,
    protein: 24,
    carbs: 8,
    fat: 14,
    assumption: "~100 g, pan-fried",
    aliases: ["tapa"],
  },
  {
    key: "egg",
    name: "Fried egg",
    qty: 1,
    unit: "pc",
    kcal: 90,
    protein: 6,
    carbs: 0,
    fat: 7,
    assumption: "1 large egg, fried in oil",
    aliases: ["egg", "itlog", "eggs"],
  },
  {
    key: "adobo",
    name: "Chicken adobo (thigh)",
    qty: 2,
    unit: "pc",
    kcal: 380,
    protein: 32,
    carbs: 4,
    fat: 26,
    assumption: "2 thigh pieces with sauce",
    aliases: ["adobo"],
  },
  {
    key: "sinigang-baboy",
    name: "Sinigang na baboy",
    qty: 1,
    unit: "bowl",
    kcal: 320,
    protein: 22,
    carbs: 10,
    fat: 21,
    assumption: "1 bowl, pork belly + kangkong, radish",
    aliases: ["sinigang"],
  },
  {
    key: "sinigang-hipon",
    name: "Sinigang na hipon",
    qty: 1,
    unit: "bowl",
    kcal: 180,
    protein: 24,
    carbs: 10,
    fat: 4,
    assumption: "1 bowl, ~8 shrimp",
    aliases: ["hipon", "shrimp"],
  },
  {
    key: "tinola",
    name: "Chicken tinola",
    qty: 1,
    unit: "bowl",
    kcal: 240,
    protein: 28,
    carbs: 8,
    fat: 10,
    assumption: "1 bowl, 2 pcs chicken + sayote",
    aliases: ["tinola"],
  },
  {
    key: "pandesal",
    name: "Pandesal",
    qty: 2,
    unit: "pc",
    kcal: 240,
    protein: 7,
    carbs: 44,
    fat: 4,
    assumption: "2 medium pieces",
    aliases: ["pandesal"],
  },
  {
    key: "coffee",
    name: "3-in-1 coffee",
    qty: 1,
    unit: "sachet",
    kcal: 70,
    protein: 1,
    carbs: 12,
    fat: 2,
    assumption: "1 sachet with sugar & creamer",
    aliases: ["coffee", "kape"],
  },
  {
    key: "longganisa",
    name: "Longganisa",
    qty: 3,
    unit: "pc",
    kcal: 330,
    protein: 15,
    carbs: 12,
    fat: 25,
    assumption: "3 pcs sweet (hamonado)",
    aliases: ["longganisa"],
  },
  {
    key: "tocino",
    name: "Pork tocino",
    qty: 100,
    unit: "g",
    kcal: 290,
    protein: 16,
    carbs: 22,
    fat: 15,
    assumption: "~100 g",
    aliases: ["tocino"],
  },
  {
    key: "bangus",
    name: "Daing na bangus",
    qty: 0.5,
    unit: "fish",
    kcal: 280,
    protein: 30,
    carbs: 0,
    fat: 17,
    assumption: "half a medium milkfish, fried",
    aliases: ["bangus", "milkfish"],
  },
  {
    key: "pinakbet",
    name: "Pinakbet",
    qty: 1,
    unit: "cup",
    kcal: 150,
    protein: 6,
    carbs: 14,
    fat: 8,
    assumption: "1 cup with bagoong",
    aliases: ["pinakbet"],
  },
  {
    key: "monggo",
    name: "Ginisang monggo",
    qty: 1,
    unit: "cup",
    kcal: 220,
    protein: 14,
    carbs: 30,
    fat: 5,
    assumption: "1 cup with malunggay",
    aliases: ["monggo", "munggo"],
  },
  {
    key: "lechon-kawali",
    name: "Lechon kawali",
    qty: 100,
    unit: "g",
    kcal: 450,
    protein: 25,
    carbs: 0,
    fat: 38,
    assumption: "~100 g, deep-fried pork belly",
    aliases: ["lechon", "kawali"],
  },
  {
    key: "pancit",
    name: "Pancit canton",
    qty: 1,
    unit: "plate",
    kcal: 400,
    protein: 12,
    carbs: 60,
    fat: 12,
    assumption: "1 plate, with veggies",
    aliases: ["pancit", "canton"],
  },
  {
    key: "whey",
    name: "Whey protein",
    qty: 1,
    unit: "scoop",
    kcal: 120,
    protein: 24,
    carbs: 3,
    fat: 2,
    assumption: "1 scoop (30 g) in water",
    aliases: ["whey", "protein shake", "shake"],
  },
  {
    key: "banana",
    name: "Banana (lakatan)",
    qty: 1,
    unit: "pc",
    kcal: 100,
    protein: 1,
    carbs: 26,
    fat: 0,
    assumption: "1 medium",
    aliases: ["banana", "saging"],
  },
  {
    key: "oatmeal",
    name: "Oatmeal with milk",
    qty: 1,
    unit: "cup",
    kcal: 250,
    protein: 10,
    carbs: 40,
    fat: 6,
    assumption: "1 cup cooked, low-fat milk",
    aliases: ["oatmeal", "oats"],
  },
  {
    key: "inasal",
    name: "Chicken inasal (breast)",
    qty: 150,
    unit: "g",
    kcal: 260,
    protein: 46,
    carbs: 2,
    fat: 7,
    assumption: "~150 g grilled breast, no skin",
    aliases: ["inasal", "grilled chicken", "chicken breast"],
  },
  {
    key: "turon",
    name: "Turon",
    qty: 1,
    unit: "pc",
    kcal: 180,
    protein: 1,
    carbs: 30,
    fat: 7,
    assumption: "1 piece",
    aliases: ["turon"],
  },
  {
    key: "nilaga",
    name: "Nilagang baka",
    qty: 1,
    unit: "bowl",
    kcal: 350,
    protein: 30,
    carbs: 12,
    fat: 20,
    assumption: "1 bowl, beef shank + potato, pechay",
    aliases: ["nilaga"],
  },
  {
    key: "tortang-talong",
    name: "Tortang talong",
    qty: 1,
    unit: "pc",
    kcal: 200,
    protein: 10,
    carbs: 8,
    fat: 14,
    assumption: "1 eggplant omelette",
    aliases: ["talong", "torta"],
  },
  {
    key: "skyflakes",
    name: "SkyFlakes crackers",
    qty: 1,
    unit: "pack",
    kcal: 130,
    protein: 3,
    carbs: 19,
    fat: 5,
    assumption: "1 pack (25 g)",
    aliases: ["skyflakes", "crackers"],
  },
  {
    key: "softdrink",
    name: "Softdrink",
    qty: 1,
    unit: "can",
    kcal: 140,
    protein: 0,
    carbs: 39,
    fat: 0,
    assumption: "1 can, 330 ml, regular",
    aliases: ["softdrink", "softdrinks", "coke", "soda"],
  },
]
export const foodByKey = (k: string) => FOODS.find((f) => f.key === k)
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const round = (n: number, step: number) => Math.round(n / step) * step
const addMin = (iso: string, min: number) =>
  new Date(new Date(iso).getTime() + min * 60000).toISOString()
const dow = (n: number) => new Date(at(n, 12)).getDay()
export const EXERCISES: Exercise[] = [
  {
    id: "bench",
    name: "Barbell Bench Press",
    equipment: "barbell",
    muscle: "chest",
    loadType: "weight",
    repMin: 6,
    repMax: 10,
    increment: 2.5,
  },
  {
    id: "incline-db",
    name: "Incline Dumbbell Press",
    equipment: "dumbbell",
    muscle: "chest",
    loadType: "weight",
    repMin: 8,
    repMax: 12,
    increment: 2,
  },
  {
    id: "ohp",
    name: "Overhead Press",
    equipment: "barbell",
    muscle: "shoulders",
    loadType: "weight",
    repMin: 6,
    repMax: 10,
    increment: 2.5,
  },
  {
    id: "lateral",
    name: "Lateral Raise",
    equipment: "dumbbell",
    muscle: "shoulders",
    loadType: "weight",
    repMin: 12,
    repMax: 15,
    increment: 1,
  },
  {
    id: "pushdown",
    name: "Triceps Pushdown",
    equipment: "cable",
    muscle: "triceps",
    loadType: "weight",
    repMin: 10,
    repMax: 15,
    increment: 2.5,
  },
  {
    id: "row",
    name: "Barbell Row",
    equipment: "barbell",
    muscle: "back",
    loadType: "weight",
    repMin: 6,
    repMax: 10,
    increment: 2.5,
  },
  {
    id: "pulldown",
    name: "Lat Pulldown",
    equipment: "cable",
    muscle: "back",
    loadType: "weight",
    repMin: 8,
    repMax: 12,
    increment: 2.5,
  },
  {
    id: "pullup",
    name: "Pull-up",
    equipment: "bodyweight",
    muscle: "back",
    loadType: "bodyweight",
    repMin: 5,
    repMax: 10,
    increment: 2.5,
  },
  {
    id: "facepull",
    name: "Face Pull",
    equipment: "cable",
    muscle: "shoulders",
    loadType: "weight",
    repMin: 12,
    repMax: 15,
    increment: 2.5,
  },
  {
    id: "curl",
    name: "Dumbbell Curl",
    equipment: "dumbbell",
    muscle: "biceps",
    loadType: "weight",
    repMin: 8,
    repMax: 12,
    increment: 1,
  },
  {
    id: "squat",
    name: "Back Squat",
    equipment: "barbell",
    muscle: "quads",
    loadType: "weight",
    repMin: 5,
    repMax: 8,
    increment: 2.5,
  },
  {
    id: "rdl",
    name: "Romanian Deadlift",
    equipment: "barbell",
    muscle: "hamstrings",
    loadType: "weight",
    repMin: 6,
    repMax: 10,
    increment: 2.5,
  },
  {
    id: "legpress",
    name: "Leg Press",
    equipment: "machine",
    muscle: "quads",
    loadType: "weight",
    repMin: 10,
    repMax: 15,
    increment: 5,
  },
  {
    id: "plank",
    name: "Plank",
    equipment: "bodyweight",
    muscle: "core",
    loadType: "time",
    repMin: 30,
    repMax: 60,
    increment: 0,
    archived: true,
  },
]
const TEMPLATES: WorkoutTemplate[] = [
  {
    id: "push-a",
    name: "Push A",
    items: [
      { exerciseId: "bench", sets: 3 },
      { exerciseId: "ohp", sets: 3 },
      { exerciseId: "incline-db", sets: 3 },
      { exerciseId: "lateral", sets: 3 },
      { exerciseId: "pushdown", sets: 3 },
    ],
  },
  {
    id: "pull-a",
    name: "Pull A",
    items: [
      { exerciseId: "row", sets: 3 },
      { exerciseId: "pulldown", sets: 3 },
      { exerciseId: "pullup", sets: 3 },
      { exerciseId: "facepull", sets: 3 },
      { exerciseId: "curl", sets: 3 },
    ],
  },
  {
    id: "legs-a",
    name: "Legs A",
    items: [
      { exerciseId: "squat", sets: 3 },
      { exerciseId: "rdl", sets: 3 },
      { exerciseId: "legpress", sets: 3 },
    ],
  },
]
const START: Record<
  string,
  {
    weight: number
    reps: number
    pUp: number
  }
> = {
  bench: { weight: 57.5, reps: 7, pUp: 0.6 },
  "incline-db": { weight: 18, reps: 9, pUp: 0.6 },
  ohp: { weight: 35, reps: 7, pUp: 0.25 },
  lateral: { weight: 7, reps: 12, pUp: 0.5 },
  pushdown: { weight: 22.5, reps: 11, pUp: 0.6 },
  row: { weight: 50, reps: 7, pUp: 0.6 },
  pulldown: { weight: 45, reps: 9, pUp: 0.6 },
  pullup: { weight: 0, reps: 6, pUp: 0.45 },
  facepull: { weight: 17.5, reps: 12, pUp: 0.5 },
  curl: { weight: 10, reps: 9, pUp: 0.5 },
  squat: { weight: 80, reps: 5, pUp: 0.65 },
  rdl: { weight: 70, reps: 7, pUp: 0.6 },
  legpress: { weight: 120, reps: 11, pUp: 0.6 },
}
function seedWorkouts(rnd: () => number): Workout[] {
  const exById = new Map(EXERCISES.map((e) => [e.id, e]))
  const prog = Object.fromEntries(
    Object.entries(START).map(([k, v]) => [k, { ...v }]),
  )
  const out: Workout[] = []
  let rot = 0
  for (let n = -70; n <= -1; n++) {
    const d = dow(n)
    if (![1, 2, 4, 6].includes(d)) continue
    if (rnd() < 0.08) continue
    const tpl = TEMPLATES[rot % 3]
    rot++
    const startedAt =
      d === 6
        ? at(n, 8, Math.floor(rnd() * 30))
        : at(n, 18, 20 + Math.floor(rnd() * 30))
    let clock = 4
    const exercises: WorkoutExercise[] = tpl.items.map((it, ei) => {
      const ex = exById.get(it.exerciseId) as Exercise
      const p = prog[ex.id]
      const sets: WorkoutSet[] = []
      if (ei === 0 && ex.equipment === "barbell") {
        sets.push({
          id: `s${n}-${ei}-w`,
          reps: 8,
          weight: round(p.weight * 0.55, 2.5),
          kind: "warmup",
          completedAt: addMin(startedAt, clock),
        })
        clock += 2
      }
      const reps: number[] = []
      for (let i = 0; i < it.sets; i++) {
        let r = p.reps
        if (i === it.sets - 1 && rnd() < 0.35) r -= 1
        else if (i > 0 && rnd() < 0.12) r -= 1
        r = Math.max(ex.repMin - 1, r)
        reps.push(r)
        clock += 2 + rnd() * 1.5
        sets.push({
          id: `s${n}-${ei}-${i}`,
          reps: r,
          weight: p.weight,
          kind: "working",
          completedAt: addMin(startedAt, clock),
        })
      }
      clock += 2
      if (ex.id === "ohp" && n > -32) {
        p.reps = Math.min(p.reps, 8)
      } else if (reps.every((r) => r >= ex.repMax)) {
        p.weight += ex.increment
        p.reps = ex.repMin
      } else if (rnd() < p.pUp) {
        p.reps = Math.min(ex.repMax, p.reps + 1)
      }
      return { id: `we${n}-${ei}`, exerciseId: ex.id, sets }
    })
    out.push({
      id: `w${-n}`,
      name: tpl.name,
      templateId: tpl.id,
      startedAt,
      endedAt: addMin(startedAt, clock + 3),
      status: "finished",
      exercises,
      clientId: `c-w${-n}`,
      source: "live",
    })
  }
  return out
}
function seedWeighIns(rnd: () => number): WeighIn[] {
  const out: WeighIn[] = []
  for (let n = -89; n <= -1; n++) {
    if (rnd() < 0.15) continue
    const t = (n + 89) / 88
    const monBump = dow(n) === 1 ? 0.35 : 0
    const w = 82 - 3.5 * t + (rnd() - 0.5) * 0.7 + monBump
    const bf = rnd() < 0.3 ? 22.8 - 3.2 * t + (rnd() - 0.5) * 0.6 : undefined
    out.push({
      id: `wi${-n}`,
      measuredAt: at(n, 6, 20 + Math.floor(rnd() * 25)),
      weightKg: Math.round(w * 10) / 10,
      ...(bf !== undefined ? { bodyFatPct: Math.round(bf * 10) / 10 } : {}),
    })
  }
  return out
}
let itemSeq = 0
let seeding = false
export function itemFromFood(f: Food, mult = 1): MealItem {
  itemSeq++
  return {
    // A UUID once the user makes the item: synced ids must be UUIDs, and a
    // "mi-…" id gets the whole /sync/push batch refused. Demo ids stay
    // readable.
    id: seeding ? `mi-${f.key}-${itemSeq}` : newId(),
    name: f.name,
    qty: Math.round(f.qty * mult * 100) / 100,
    unit: f.unit,
    kcal: Math.round(f.kcal * mult),
    protein: Math.round(f.protein * mult),
    carbs: Math.round(f.carbs * mult),
    fat: Math.round(f.fat * mult),
    assumption: f.assumption,
  }
}
const B = [
  ["garlic-rice", "tapa", "egg"],
  ["garlic-rice", "longganisa", "egg"],
  ["pandesal", "egg", "coffee"],
  ["oatmeal", "banana", "whey"],
  ["garlic-rice", "tocino", "egg"],
]
const L = [
  ["rice", "adobo"],
  ["rice", "sinigang-baboy"],
  ["rice", "tinola"],
  ["rice", "monggo", "bangus"],
  ["rice", "inasal"],
  ["rice", "pinakbet", "lechon-kawali"],
  ["rice", "nilaga"],
  ["rice", "sinigang-hipon", "tortang-talong"],
]
const S = [
  ["whey", "banana"],
  ["whey"],
  ["whey", "banana"],
  ["turon"],
  ["skyflakes", "coffee"],
  ["pancit"],
]
const SOURCES: MealSource[] = [
  "photo",
  "photo",
  "text",
  "voice",
  "manual",
  "connector",
]
function mkMeal(
  id: string,
  eatenAt: string,
  label: MealLabel,
  keys: string[],
  rnd: () => number,
  status: MealStatus = "confirmed",
): Meal {
  const source = SOURCES[Math.floor(rnd() * SOURCES.length)]
  const items = keys.map((k) => {
    const f = foodByKey(k) as Food
    const mult = k === "rice" && rnd() < 0.3 ? 1.5 : 1
    return itemFromFood(f, mult)
  })
  return {
    id,
    eatenAt,
    label,
    source,
    photo: source === "photo",
    rawInput:
      source === "photo"
        ? "Photo"
        : items
            .map((i) => `${i.qty} ${i.unit} ${i.name.toLowerCase()}`)
            .join(", "),
    status,
    confidence: source === "manual" ? undefined : 0.62 + rnd() * 0.3,
    items,
  }
}
function seedMeals(rnd: () => number): Meal[] {
  const out: Meal[] = []
  for (let n = -13; n <= -1; n++) {
    out.push(
      mkMeal(
        `m${-n}b`,
        at(n, 7, 15),
        "breakfast",
        B[Math.floor(rnd() * B.length)],
        rnd,
      ),
    )
    out.push(
      mkMeal(
        `m${-n}l`,
        at(n, 12, 20),
        "lunch",
        L[Math.floor(rnd() * L.length)],
        rnd,
      ),
    )
    if (rnd() < 0.8)
      out.push(
        mkMeal(
          `m${-n}s`,
          at(n, 16, 0),
          "snack",
          S[Math.floor(rnd() * S.length)],
          rnd,
        ),
      )
    if (rnd() < 0.84)
      out.push(
        mkMeal(
          `m${-n}d`,
          at(n, 19, 45),
          "dinner",
          L[Math.floor(rnd() * L.length)],
          rnd,
        ),
      )
    if (rnd() < 0.7)
      out.push(mkMeal(`m${-n}p`, at(n, 21, 15), "snack", ["whey"], rnd))
  }
  out.push({
    ...mkMeal("m0b", at(0, 7, 10), "breakfast", B[0], rnd),
    source: "voice",
    photo: false,
    rawInput: "tapsilog, isang cup na garlic rice",
  })
  out.push({
    id: "m0l",
    eatenAt: at(0, 12, 30),
    label: "lunch",
    source: "photo",
    photo: true,
    rawInput: 'Photo · "adobo sa bahay"',
    status: "estimated",
    confidence: 0.72,
    items: [
      itemFromFood(foodByKey("rice") as Food),
      itemFromFood(foodByKey("adobo") as Food),
      itemFromFood(foodByKey("pinakbet") as Food),
    ],
    followUp: {
      question: "How much rice was on the plate?",
      options: ["1 cup", "1.5 cups", "2 cups"],
    },
  })
  out.push({
    id: "m0s",
    eatenAt: at(0, 15, 40),
    label: "snack",
    source: "photo",
    photo: true,
    rawInput: "Photo",
    status: "pending_estimate",
    items: [],
  })
  return out
}
export function seed(): FitnessState {
  itemSeq = 0
  seeding = true
  const rnd = mulberry32(3)
  const state: FitnessState = {
    exercises: EXERCISES,
    templates: TEMPLATES,
    workouts: seedWorkouts(rnd),
    weighIns: seedWeighIns(rnd),
    targets: [
      {
        id: "t1",
        effectiveFrom: dayKey(new Date(at(-90, 12))),
        kcal: 2300,
        protein: 160,
        carbs: 245,
        fat: 72,
      },
      {
        id: "t2",
        effectiveFrom: dayKey(new Date(at(-35, 12))),
        kcal: 2100,
        protein: 150,
        carbs: 220,
        fat: 70,
      },
    ],
    meals: seedMeals(rnd),
    settings: {
      units: "kg",
      restSec: 120,
      weeklyTarget: 4,
      weighInReminder: "06:30",
      progression: "double",
      aiSource: "builtin",
      goalDirection: "cut",
      goalWeight: 76,
    },
    activeId: null,
    rest: null,
  }
  seeding = false
  return state
}
