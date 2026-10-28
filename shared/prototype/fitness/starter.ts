"use client"
import { derivedId } from "../lib/ids"
import type {
  Equipment,
  Exercise,
  LoadType,
  Muscle,
  TemplateItem,
  TimeTrack,
  WorkoutTemplate,
} from "./data"
import { fitStore } from "./store"

// The gym library and ready-made splits a new account starts with, so a
// first workout is a tap, not an evening of data entry. Ids are derived
// from the account and a fixed key: two devices installing offline mint the
// same rows, and sync merges them instead of doubling them.

type Row = [
  key: string,
  name: string,
  equipment: Equipment,
  muscle: Muscle,
  loadType: LoadType,
  repMin: number,
  repMax: number,
  track?: TimeTrack,
]

const INCREMENT: Record<Equipment, number> = {
  barbell: 2.5,
  dumbbell: 2,
  machine: 5,
  cable: 2.5,
  bodyweight: 2.5,
}

export const STARTER_EXERCISES: Row[] = [
  // Chest
  ["bench", "Barbell Bench Press", "barbell", "chest", "weight", 6, 10],
  [
    "incline-bench",
    "Incline Barbell Bench Press",
    "barbell",
    "chest",
    "weight",
    6,
    10,
  ],
  ["decline-bench", "Decline Bench Press", "barbell", "chest", "weight", 6, 10],
  ["db-bench", "Dumbbell Bench Press", "dumbbell", "chest", "weight", 8, 12],
  [
    "incline-db",
    "Incline Dumbbell Press",
    "dumbbell",
    "chest",
    "weight",
    8,
    12,
  ],
  ["db-fly", "Dumbbell Fly", "dumbbell", "chest", "weight", 10, 15],
  ["cable-cross", "Cable Crossover", "cable", "chest", "weight", 10, 15],
  ["pec-deck", "Pec Deck", "machine", "chest", "weight", 10, 15],
  ["chest-press", "Machine Chest Press", "machine", "chest", "weight", 8, 12],
  ["pushup", "Push-up", "bodyweight", "chest", "bodyweight", 10, 20],
  ["chest-dip", "Chest Dip", "bodyweight", "chest", "bodyweight", 6, 12],
  // Back
  ["deadlift", "Deadlift", "barbell", "back", "weight", 3, 6],
  ["row", "Barbell Row", "barbell", "back", "weight", 6, 10],
  ["pendlay", "Pendlay Row", "barbell", "back", "weight", 5, 8],
  ["db-row", "One-Arm Dumbbell Row", "dumbbell", "back", "weight", 8, 12],
  ["tbar", "T-Bar Row", "machine", "back", "weight", 8, 12],
  ["cable-row", "Seated Cable Row", "cable", "back", "weight", 8, 12],
  ["chest-row", "Chest-Supported Row", "machine", "back", "weight", 8, 12],
  ["pulldown", "Lat Pulldown", "cable", "back", "weight", 8, 12],
  ["cg-pulldown", "Close-Grip Lat Pulldown", "cable", "back", "weight", 8, 12],
  [
    "straight-pulldown",
    "Straight-Arm Pulldown",
    "cable",
    "back",
    "weight",
    10,
    15,
  ],
  ["pullup", "Pull-up", "bodyweight", "back", "bodyweight", 5, 10],
  ["chinup", "Chin-up", "bodyweight", "back", "bodyweight", 5, 10],
  ["back-ext", "Back Extension", "bodyweight", "back", "bodyweight", 10, 15],
  ["shrug", "Dumbbell Shrug", "dumbbell", "back", "weight", 10, 15],
  // Shoulders
  ["ohp", "Overhead Press", "barbell", "shoulders", "weight", 6, 10],
  [
    "db-ohp",
    "Seated Dumbbell Shoulder Press",
    "dumbbell",
    "shoulders",
    "weight",
    8,
    12,
  ],
  ["arnold", "Arnold Press", "dumbbell", "shoulders", "weight", 8, 12],
  [
    "machine-ohp",
    "Machine Shoulder Press",
    "machine",
    "shoulders",
    "weight",
    8,
    12,
  ],
  ["lateral", "Lateral Raise", "dumbbell", "shoulders", "weight", 12, 15],
  [
    "cable-lateral",
    "Cable Lateral Raise",
    "cable",
    "shoulders",
    "weight",
    12,
    15,
  ],
  ["front-raise", "Front Raise", "dumbbell", "shoulders", "weight", 10, 15],
  ["rear-fly", "Rear Delt Fly", "dumbbell", "shoulders", "weight", 12, 15],
  ["reverse-pec", "Reverse Pec Deck", "machine", "shoulders", "weight", 12, 15],
  ["facepull", "Face Pull", "cable", "shoulders", "weight", 12, 15],
  ["upright-row", "Upright Row", "barbell", "shoulders", "weight", 10, 12],
  // Biceps
  ["bb-curl", "Barbell Curl", "barbell", "biceps", "weight", 8, 12],
  ["ez-curl", "EZ-Bar Curl", "barbell", "biceps", "weight", 8, 12],
  ["curl", "Dumbbell Curl", "dumbbell", "biceps", "weight", 8, 12],
  ["hammer", "Hammer Curl", "dumbbell", "biceps", "weight", 8, 12],
  [
    "incline-curl",
    "Incline Dumbbell Curl",
    "dumbbell",
    "biceps",
    "weight",
    8,
    12,
  ],
  ["preacher", "Preacher Curl", "machine", "biceps", "weight", 8, 12],
  ["cable-curl", "Cable Curl", "cable", "biceps", "weight", 10, 15],
  ["conc-curl", "Concentration Curl", "dumbbell", "biceps", "weight", 10, 12],
  // Triceps
  ["pushdown", "Triceps Pushdown", "cable", "triceps", "weight", 10, 15],
  ["rope-pushdown", "Rope Pushdown", "cable", "triceps", "weight", 10, 15],
  [
    "oh-cable-ext",
    "Overhead Cable Extension",
    "cable",
    "triceps",
    "weight",
    10,
    15,
  ],
  ["skull", "Skull Crusher", "barbell", "triceps", "weight", 8, 12],
  ["cg-bench", "Close-Grip Bench Press", "barbell", "triceps", "weight", 6, 10],
  [
    "oh-db-ext",
    "Overhead Dumbbell Extension",
    "dumbbell",
    "triceps",
    "weight",
    10,
    12,
  ],
  ["tri-dip", "Triceps Dip", "bodyweight", "triceps", "bodyweight", 8, 12],
  ["kickback", "Triceps Kickback", "dumbbell", "triceps", "weight", 12, 15],
  // Quads
  ["squat", "Back Squat", "barbell", "quads", "weight", 5, 8],
  ["front-squat", "Front Squat", "barbell", "quads", "weight", 5, 8],
  ["hack", "Hack Squat", "machine", "quads", "weight", 8, 12],
  ["smith-squat", "Smith Machine Squat", "machine", "quads", "weight", 8, 12],
  ["legpress", "Leg Press", "machine", "quads", "weight", 10, 15],
  ["leg-ext", "Leg Extension", "machine", "quads", "weight", 10, 15],
  ["bulgarian", "Bulgarian Split Squat", "dumbbell", "quads", "weight", 8, 12],
  ["lunge", "Walking Lunge", "dumbbell", "quads", "weight", 10, 12],
  ["goblet", "Goblet Squat", "dumbbell", "quads", "weight", 10, 12],
  // Hamstrings
  ["rdl", "Romanian Deadlift", "barbell", "hamstrings", "weight", 6, 10],
  ["sldl", "Stiff-Leg Deadlift", "barbell", "hamstrings", "weight", 6, 10],
  ["lying-curl", "Lying Leg Curl", "machine", "hamstrings", "weight", 10, 15],
  ["seated-curl", "Seated Leg Curl", "machine", "hamstrings", "weight", 10, 15],
  ["good-morning", "Good Morning", "barbell", "hamstrings", "weight", 8, 12],
  ["nordic", "Nordic Curl", "bodyweight", "hamstrings", "bodyweight", 4, 8],
  // Glutes
  ["hip-thrust", "Barbell Hip Thrust", "barbell", "glutes", "weight", 8, 12],
  [
    "glute-bridge",
    "Glute Bridge",
    "bodyweight",
    "glutes",
    "bodyweight",
    12,
    20,
  ],
  ["sumo-dl", "Sumo Deadlift", "barbell", "glutes", "weight", 3, 6],
  [
    "cable-kickback",
    "Cable Glute Kickback",
    "cable",
    "glutes",
    "weight",
    12,
    15,
  ],
  ["abduction", "Hip Abduction", "machine", "glutes", "weight", 12, 20],
  ["stepup", "Dumbbell Step-up", "dumbbell", "glutes", "weight", 8, 12],
  // Core
  ["plank", "Plank", "bodyweight", "core", "time", 30, 60, "weight"],
  ["side-plank", "Side Plank", "bodyweight", "core", "time", 30, 60],
  ["leg-raise", "Hanging Leg Raise", "bodyweight", "core", "bodyweight", 8, 15],
  ["cable-crunch", "Cable Crunch", "cable", "core", "weight", 10, 15],
  ["ab-wheel", "Ab Wheel Rollout", "bodyweight", "core", "reps", 8, 15],
  ["crunch", "Crunch", "bodyweight", "core", "reps", 15, 25],
  ["russian-twist", "Russian Twist", "bodyweight", "core", "reps", 15, 30],
  // Calves
  [
    "standing-calf",
    "Standing Calf Raise",
    "machine",
    "calves",
    "weight",
    10,
    15,
  ],
  ["seated-calf", "Seated Calf Raise", "machine", "calves", "weight", 12, 20],
  ["press-calf", "Leg Press Calf Raise", "machine", "calves", "weight", 12, 20],
  [
    "db-calf",
    "Single-Leg Dumbbell Calf Raise",
    "dumbbell",
    "calves",
    "weight",
    10,
    15,
  ],
  // Forearms
  ["wrist-curl", "Wrist Curl", "dumbbell", "forearms", "weight", 12, 20],
  [
    "reverse-wrist",
    "Reverse Wrist Curl",
    "dumbbell",
    "forearms",
    "weight",
    12,
    20,
  ],
  [
    "reverse-curl",
    "Reverse Barbell Curl",
    "barbell",
    "forearms",
    "weight",
    10,
    15,
  ],
  [
    "farmer",
    "Farmer's Carry",
    "dumbbell",
    "forearms",
    "time",
    30,
    60,
    "weight",
  ],
  // Cardio
  ["walk", "Incline Walk", "machine", "cardio", "time", 1, 1, "speed"],
  ["run", "Run", "bodyweight", "cardio", "time", 1, 1, "speed"],
  ["bike", "Stationary Bike", "machine", "cardio", "time", 1, 1, "speed"],
  ["rower", "Rowing Machine", "machine", "cardio", "time", 1, 1],
  ["elliptical", "Elliptical", "machine", "cardio", "time", 1, 1],
  ["stairs", "Stair Climber", "machine", "cardio", "time", 1, 1],
  ["jump-rope", "Jump Rope", "bodyweight", "cardio", "time", 1, 1],
]

/** Exercise keys and sets; a [key, sets, seconds] item is a timed goal. */
type Split = [key: string, name: string, items: [string, number, number?][]]

export const STARTER_SPLITS: Split[] = [
  [
    "push",
    "Push",
    [
      ["bench", 4],
      ["ohp", 3],
      ["incline-db", 3],
      ["cable-cross", 3],
      ["lateral", 3],
      ["pushdown", 3],
      ["oh-cable-ext", 3],
    ],
  ],
  [
    "pull",
    "Pull",
    [
      ["deadlift", 3],
      ["pullup", 3],
      ["row", 3],
      ["cable-row", 3],
      ["facepull", 3],
      ["bb-curl", 3],
      ["hammer", 3],
    ],
  ],
  [
    "legs",
    "Legs",
    [
      ["squat", 4],
      ["rdl", 3],
      ["legpress", 3],
      ["leg-ext", 3],
      ["lying-curl", 3],
      ["hip-thrust", 3],
      ["standing-calf", 4],
      ["leg-raise", 3],
    ],
  ],
  [
    "upper",
    "Upper",
    [
      ["bench", 4],
      ["row", 4],
      ["ohp", 3],
      ["pulldown", 3],
      ["lateral", 3],
      ["curl", 3],
      ["pushdown", 3],
    ],
  ],
  [
    "lower",
    "Lower",
    [
      ["squat", 4],
      ["rdl", 3],
      ["bulgarian", 3],
      ["seated-curl", 3],
      ["leg-ext", 3],
      ["hip-thrust", 3],
      ["seated-calf", 4],
      ["cable-crunch", 3],
    ],
  ],
  [
    "full-a",
    "Full Body A",
    [
      ["squat", 3],
      ["bench", 3],
      ["row", 3],
      ["ohp", 3],
      ["curl", 2],
      ["pushdown", 2],
      ["plank", 3],
    ],
  ],
  [
    "full-b",
    "Full Body B",
    [
      ["deadlift", 3],
      ["incline-db", 3],
      ["pullup", 3],
      ["lunge", 3],
      ["lateral", 3],
      ["hammer", 2],
      ["cable-crunch", 3],
    ],
  ],
  [
    "chest-tri",
    "Chest & Triceps",
    [
      ["bench", 4],
      ["incline-db", 3],
      ["chest-press", 3],
      ["cable-cross", 3],
      ["chest-dip", 3],
      ["skull", 3],
      ["rope-pushdown", 3],
    ],
  ],
  [
    "back-bi",
    "Back & Biceps",
    [
      ["deadlift", 3],
      ["pullup", 3],
      ["row", 3],
      ["cable-row", 3],
      ["pulldown", 3],
      ["bb-curl", 3],
      ["hammer", 3],
    ],
  ],
  [
    "shoulders-abs",
    "Shoulders & Abs",
    [
      ["ohp", 4],
      ["arnold", 3],
      ["lateral", 4],
      ["rear-fly", 3],
      ["shrug", 3],
      ["leg-raise", 3],
      ["cable-crunch", 3],
    ],
  ],
  [
    "arms",
    "Arms",
    [
      ["cg-bench", 3],
      ["bb-curl", 3],
      ["skull", 3],
      ["incline-curl", 3],
      ["rope-pushdown", 3],
      ["hammer", 3],
      ["oh-db-ext", 3],
      ["wrist-curl", 3],
      ["reverse-curl", 3],
    ],
  ],
  [
    "cardio-core",
    "Cardio & Core",
    [
      ["walk", 1, 1200],
      ["plank", 3],
      ["leg-raise", 3],
      ["russian-twist", 3],
      ["ab-wheel", 3],
    ],
  ],
]

/** Adds the starter exercises an account is missing (matched by name, so
 * nothing the person has is doubled; exercises are archived, never deleted,
 * so none comes back), and the splits when it has no split at all (a split
 * the person deleted never comes back). Returns how many were added. */
export function installStarter(owner: string): {
  exercises: number
  templates: number
} {
  const s = fitStore.get()
  const byName = new Map(s.exercises.map((e) => [e.name.toLowerCase(), e.id]))
  const idOf = new Map<string, string>()
  const exercises: Exercise[] = []
  for (const [
    key,
    name,
    equipment,
    muscle,
    loadType,
    repMin,
    repMax,
    track,
  ] of STARTER_EXERCISES) {
    const have = byName.get(name.toLowerCase())
    if (have) {
      idOf.set(key, have)
      continue
    }
    const id = derivedId("starter-exercise", owner, key)
    idOf.set(key, id)
    exercises.push({
      id,
      name,
      equipment,
      muscle,
      loadType,
      repMin,
      repMax,
      increment: loadType === "time" ? 0 : INCREMENT[equipment],
      ...(track ? { track } : {}),
    })
  }
  const templates: WorkoutTemplate[] = (
    s.templates.length ? [] : STARTER_SPLITS
  ).map(([key, name, items]) => ({
    id: derivedId("starter-template", owner, key),
    name,
    items: items.map(
      ([k, sets, targetSec]): TemplateItem => ({
        exerciseId: idOf.get(k) as string,
        sets,
        ...(targetSec ? { targetSec } : {}),
      }),
    ),
  }))
  if (exercises.length || templates.length)
    fitStore.set((st) => ({
      ...st,
      exercises: [...st.exercises, ...exercises],
      templates: [...st.templates, ...templates],
    }))
  return { exercises: exercises.length, templates: templates.length }
}
