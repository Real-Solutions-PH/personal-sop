// The lock screen shows the current exercise's previous best and what comes
// next, and a routine can be finished from it. Built from hand-made fitness
// states so every expected string is read off the fixture, not the code.

import { previousBest } from "@domain/fitness/calc"
import type {
  Exercise,
  FitnessState,
  Workout,
  WorkoutSet,
} from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { buildLiveState, liveKey } from "../live-state"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  liveStore.set({ live: null })
  habitsStore.set((s) => ({
    ...s,
    runs: s.runs.filter((r) => r.day !== dayKey()),
    timer: null,
  }))
})

const NOW = new Date(2026, 9, 30, 18, 0).getTime()
const iso = (daysAgo: number, min = 0) =>
  new Date(NOW - daysAgo * 86_400_000 + min * 60_000).toISOString()

const ex = (
  id: string,
  name: string,
  loadType: Exercise["loadType"] = "weight",
): Exercise => ({
  id,
  name,
  equipment: "barbell",
  muscle: loadType === "time" ? "cardio" : "chest",
  loadType,
  repMin: 6,
  repMax: 10,
  increment: 2.5,
})

let n = 0
const set = (
  weight: number,
  reps: number,
  over: Partial<WorkoutSet> = {},
): WorkoutSet => ({
  id: `s${++n}`,
  weight,
  reps,
  kind: "working",
  completedAt: iso(0),
  ...over,
})

const workout = (
  id: string,
  daysAgo: number,
  exercises: { exerciseId: string; sets: WorkoutSet[] }[],
  over: Partial<Workout> = {},
): Workout => ({
  id,
  name: "Push",
  startedAt: iso(daysAgo),
  endedAt: iso(daysAgo, 50),
  status: "finished",
  clientId: id,
  exercises: exercises.map((e, i) => ({ id: `${id}-we${i}`, ...e })),
  ...over,
})

const BENCH = ex("bench", "Bench Press")
const INCLINE = ex("incline", "Incline Dumbbell Press")
const WALK = ex("walk", "Treadmill Walk", "time")
const PUSHUP = ex("pushup", "Push-up", "bodyweight")

function state(workouts: Workout[], over: Partial<FitnessState> = {}) {
  const base = fitStore.get()
  return {
    ...base,
    exercises: [BENCH, INCLINE, WALK, PUSHUP],
    workouts,
    weighIns: [],
    activeId: null,
    rest: null,
    settings: { ...base.settings, units: "kg" as const, restSec: 90 },
    ...over,
  } satisfies FitnessState
}

/** An in-progress workout with nothing done yet. */
const active = (exercises: { exerciseId: string; sets: WorkoutSet[] }[]) =>
  workout("now", 0, exercises, { status: "in_progress", endedAt: undefined })

const open = (weight: number, reps: number, over: Partial<WorkoutSet> = {}) =>
  set(weight, reps, { completedAt: undefined, ...over })

function live(fit: FitnessState, now = NOW) {
  return buildLiveState({
    live: {
      kind: "workout",
      href: "/fitness/workout",
      startedAt: iso(0),
    } as never,
    habits: habitsStore.get(),
    fit,
    now,
  })
}

describe("previousBest", () => {
  it("picks the best estimated 1-rep max, leaving out the given workout, warm-ups and unfinished sets", () => {
    // e1RM: 80×8 = 101.3; 85×6 = 102; a 120 warm-up and an unfinished 110×5
    // would win if counted; the excluded workout's 100×5 = 116.7 too.
    const s = state([
      workout("a", 7, [{ exerciseId: "bench", sets: [set(80, 8)] }]),
      workout("b", 3, [
        {
          exerciseId: "bench",
          sets: [
            set(120, 3, { kind: "warmup" }),
            set(85, 6),
            set(110, 5, { completedAt: undefined }),
          ],
        },
      ]),
      workout("now", 0, [{ exerciseId: "bench", sets: [set(100, 5)] }]),
    ])
    const best = previousBest(s, "bench", "now")
    expect(best).toMatchObject({ weight: 85, reps: 6 })
  })

  it("has none without history other than the excluded workout", () => {
    const s = state([
      workout("now", 0, [{ exerciseId: "bench", sets: [set(100, 5)] }]),
    ])
    expect(previousBest(s, "bench", "now")).toBeUndefined()
    expect(previousBest(s, "incline", "now")).toBeUndefined()
  })

  it("is the longest set of a timed exercise and the most reps without load", () => {
    const s = state([
      workout("a", 4, [
        {
          exerciseId: "walk",
          sets: [
            set(0, 0, { durationSec: 900 }),
            set(0, 0, { durationSec: 1200 }),
          ],
        },
        { exerciseId: "pushup", sets: [set(0, 12), set(0, 15)] },
      ]),
      workout("b", 2, [
        { exerciseId: "walk", sets: [set(0, 0, { durationSec: 600 })] },
        { exerciseId: "pushup", sets: [set(0, 10)] },
      ]),
    ])
    expect(previousBest(s, "walk", "now")).toMatchObject({ durationSec: 1200 })
    expect(previousBest(s, "pushup", "now")).toMatchObject({ reps: 15 })
  })

  it("bodyweight reps stay the most reps once a weigh-in exists", () => {
    // With a body weight, sets are ranked by estimated max, which skips sets
    // past 12 reps; the 15 must still win.
    const s = state(
      [
        workout("a", 4, [
          { exerciseId: "pushup", sets: [set(0, 10), set(0, 15)] },
        ]),
      ],
      {
        weighIns: [{ id: "wi", measuredAt: iso(5), weightKg: 70 }],
      },
    )
    expect(previousBest(s, "pushup", "now")).toMatchObject({ reps: 15 })
  })

  it("counts a workout logged from chat", () => {
    const s = state([
      workout("c", 2, [{ exerciseId: "bench", sets: [set(70, 5)] }], {
        source: "chat",
      }),
    ])
    expect(previousBest(s, "bench", "now")).toMatchObject({ weight: 70 })
  })
})

describe("the lock screen's best and next-up", () => {
  it("shows the best set of the current exercise in that set's unit", () => {
    const s = state(
      [
        workout("a", 7, [{ exerciseId: "bench", sets: [set(80, 8)] }]),
        workout("b", 3, [{ exerciseId: "bench", sets: [set(85, 6)] }]),
        active([{ exerciseId: "bench", sets: [open(85, 6), open(85, 6)] }]),
      ],
      { activeId: "now" },
    )
    expect(live(s)?.best).toBe("Best 85 kg × 6")
  })

  it("a past best entered in pounds stays in pounds, grouped", () => {
    // 462.66 kg is 1,020 lb.
    const s = state(
      [
        workout("a", 3, [
          { exerciseId: "bench", sets: [set(462.66, 1, { unit: "lb" })] },
        ]),
        active([{ exerciseId: "bench", sets: [open(100, 5)] }]),
      ],
      { activeId: "now" },
    )
    expect(live(s)?.best).toBe("Best 1,020 lb × 1")
  })

  it("leaves best out when the exercise has no history", () => {
    const s = state(
      [active([{ exerciseId: "incline", sets: [open(30, 8), open(30, 8)] }])],
      { activeId: "now" },
    )
    const l = live(s)
    expect(l?.best).toBeUndefined()
    expect(l && "best" in l).toBe(false)
    expect(l?.next[0] && "best" in l.next[0]).toBe(false)
  })

  it("each upcoming row carries its own exercise's best", () => {
    const s = state(
      [
        workout("a", 3, [
          { exerciseId: "bench", sets: [set(85, 6)] },
          { exerciseId: "incline", sets: [set(30, 10)] },
        ]),
        active([
          { exerciseId: "bench", sets: [open(85, 6), open(85, 6)] },
          { exerciseId: "incline", sets: [open(30, 8)] },
          { exerciseId: "pushup", sets: [open(0, 12)] },
        ]),
      ],
      { activeId: "now" },
    )
    const l = live(s)
    expect(l?.next.map((x) => [x.label, x.best])).toEqual([
      ["Bench Press", "Best 85 kg × 6"],
      ["Incline Dumbbell Press", "Best 30 kg × 10"],
      ["Push-up", undefined],
    ])
    expect(l?.next[1].detail).toBe("Set 1 of 1 · 30 kg × 8")
  })

  it("formats a timed best in minutes and a reps-only best in reps", () => {
    const s = state(
      [
        workout("a", 3, [
          { exerciseId: "walk", sets: [set(0, 0, { durationSec: 1200 })] },
          { exerciseId: "pushup", sets: [set(0, 15)] },
        ]),
        active([
          { exerciseId: "walk", sets: [open(0, 0, { durationSec: 600 })] },
          { exerciseId: "pushup", sets: [open(0, 10)] },
        ]),
      ],
      { activeId: "now" },
    )
    const l = live(s)
    expect(l?.best).toBe("Best 20 min")
    expect(l?.next[0].best).toBe("Best 15 reps")
  })

  it("a timed best under a minute reads in seconds", () => {
    const s = state(
      [
        workout("a", 3, [
          { exerciseId: "walk", sets: [set(0, 0, { durationSec: 20 })] },
        ]),
        active([
          { exerciseId: "walk", sets: [open(0, 0, { durationSec: 30 })] },
        ]),
      ],
      { activeId: "now" },
    )
    expect(live(s)?.best).toBe("Best 20 s")
  })

  it("the set detail groups thousands like the best does", () => {
    const s = state(
      [
        active([
          { exerciseId: "bench", sets: [open(462.66, 1, { unit: "lb" })] },
        ]),
      ],
      { activeId: "now" },
    )
    expect(live(s)?.detail).toBe("Set 1 of 1 · 1,020 lb × 1")
  })

  it("a current warm-up still shows the exercise's best working set", () => {
    const s = state(
      [
        workout("a", 3, [{ exerciseId: "bench", sets: [set(85, 6)] }]),
        active([
          {
            exerciseId: "bench",
            sets: [open(40, 10, { kind: "warmup" }), open(85, 6)],
          },
        ]),
      ],
      { activeId: "now" },
    )
    const l = live(s)
    expect(l?.detail).toMatch(/^Warm-up/)
    expect(l?.best).toBe("Best 85 kg × 6")
  })

  it("follows a replaced exercise", () => {
    const hist = [
      workout("a", 3, [
        { exerciseId: "bench", sets: [set(85, 6)] },
        { exerciseId: "incline", sets: [set(30, 10)] },
      ]),
    ]
    const before = state(
      [...hist, active([{ exerciseId: "bench", sets: [open(80, 8)] }])],
      { activeId: "now" },
    )
    const after = state(
      [...hist, active([{ exerciseId: "incline", sets: [open(30, 8)] }])],
      { activeId: "now" },
    )
    expect(live(before)?.best).toBe("Best 85 kg × 6")
    expect(live(after)?.best).toBe("Best 30 kg × 10")
  })

  it("does not change between two builds 30 seconds apart", () => {
    const s = state(
      [
        workout("a", 3, [{ exerciseId: "bench", sets: [set(85, 6)] }]),
        active([{ exerciseId: "bench", sets: [open(85, 6), open(85, 6)] }]),
      ],
      { activeId: "now" },
    )
    expect(liveKey(live(s, NOW))).toBe(liveKey(live(s, NOW + 30_000)))
  })

  it("a worst-case workout stays well under ActivityKit's 4 KB", () => {
    const names = Array.from({ length: 10 }, (_, i) =>
      ex(
        `x${i}`,
        `${"Single-Arm Landmine Rotational Press"} ${i}`.padEnd(40, "x"),
      ),
    )
    expect(names[0].name).toHaveLength(40)
    const heavy = (i: number) => set(1234.5, 12, { unit: i % 2 ? "lb" : "kg" })
    const hist = workout(
      "a",
      3,
      names.map((e, i) => ({ exerciseId: e.id, sets: [heavy(i)] })),
    )
    const now = active(
      names.map((e) => ({
        exerciseId: e.id,
        sets: [open(1234.5, 12, { unit: "lb" })],
      })),
    )
    const s = state([hist, now], {
      activeId: "now",
      exercises: names,
      rest: { endsAt: new Date(NOW + 60_000).toISOString(), durationSec: 90 },
    })
    const l = live(s)
    expect(l?.next).toHaveLength(8)
    expect(l?.next.every((x) => x.best)).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(l)).length).toBeLessThan(
      3500,
    )
  })
})

describe("a routine on the lock screen", () => {
  const routineLive = () =>
    buildLiveState({
      live: liveStore.get().live,
      habits: habitsStore.get(),
      fit: fitStore.get(),
      now: Date.now(),
    })
  it("offers Finish after Done, Skip and Pause, and Resume while paused", () => {
    const r = habitsStore
      .get()
      .routines.find((x) => x.status === "active" && x.steps.length >= 2)
    if (!r) throw new Error("no routine")
    const run = HA.startRoutine(r.id)
    if (!run) throw new Error("not started")
    expect(routineLive()?.controls).toEqual(["done", "skip", "pause", "finish"])
    HA.toggleRunPause(run)
    expect(routineLive()?.controls).toEqual([
      "done",
      "skip",
      "resume",
      "finish",
    ])
    // Routines carry no best.
    expect(routineLive()?.best).toBeUndefined()
  })
})
