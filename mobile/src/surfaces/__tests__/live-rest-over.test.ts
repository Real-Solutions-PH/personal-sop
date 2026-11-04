// While a workout rests, the Live Activity carries what it shows once the
// countdown hits zero ("Rest over · time for set 3" and the next set's
// target), so iOS can flip to it at the stale date without the app. Expected
// strings are read off the fixtures, not the code.

import type {
  Exercise,
  FitnessState,
  Workout,
  WorkoutSet,
} from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { buildLiveState, restOverLines } from "../live-state"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  liveStore.set({ live: null })
})

const NOW = new Date(2026, 10, 4, 8, 40).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const CABLE: Exercise = {
  id: "cable",
  name: "One arm tricep cable pushdown",
  equipment: "cable",
  muscle: "triceps",
  loadType: "weight",
  repMin: 8,
  repMax: 12,
  increment: 2.5,
}

let n = 0
const set = (
  weight: number,
  reps: number,
  done: boolean,
  over: Partial<WorkoutSet> = {},
): WorkoutSet => ({
  id: `s${++n}`,
  weight,
  reps,
  kind: "working",
  ...(done ? { completedAt: iso(NOW - 60_000) } : {}),
  ...over,
})

function fitness(sets: WorkoutSet[], restEndsAt: number | null): FitnessState {
  const base = fitStore.get()
  const w: Workout = {
    id: "w1",
    name: "Pull main",
    startedAt: iso(NOW - 3_600_000),
    status: "in_progress",
    clientId: "w1",
    exercises: [{ id: "we1", exerciseId: "cable", sets }],
  }
  return {
    ...base,
    exercises: [CABLE],
    workouts: [w],
    weighIns: [],
    activeId: "w1",
    rest: restEndsAt ? { endsAt: iso(restEndsAt), durationSec: 90 } : null,
    settings: { ...base.settings, units: "kg" as const, restSec: 90 },
  }
}

const live = (state: FitnessState) =>
  buildLiveState({
    live: {
      kind: "workout",
      href: "/fitness/workout",
      startedAt: iso(NOW),
    } as never,
    habits: habitsStore.get(),
    fit: state,
    now: NOW,
  })

describe("the rest-over state", () => {
  it("names the set that is up next and its target while resting", () => {
    // Two of three sets done; the third (50 kg × 11) is next.
    const s = live(
      fitness(
        [set(50, 10, true), set(50, 10, true), set(50, 11, false)],
        NOW + 30_000,
      ),
    )
    expect(s?.restEndsAt).toBe(NOW + 30_000)
    expect(s?.restOver).toEqual({
      title: "Rest over · time for set 3",
      target: "Set 3 of 3 · 50 kg × 11",
    })
  })

  it("is absent when not resting, or once the rest has run out", () => {
    const sets = () => [set(50, 10, true), set(50, 11, false)]
    expect(live(fitness(sets(), null))?.restOver).toBeUndefined()
    expect(live(fitness(sets(), NOW - 1_000))?.restOver).toBeUndefined()
  })

  it("says the workout can end when no set is left", () => {
    const s = live(fitness([set(50, 10, true)], NOW + 30_000))
    expect(s?.restOver).toEqual({
      title: "Rest over · finish when you're ready",
      target: "All sets done",
    })
  })

  it("calls a warm-up a warm-up", () => {
    expect(
      restOverLines({ label: "Bench", detail: "Warm-up · 20 kg × 10" }, true),
    ).toEqual({
      title: "Rest over · time for the warm-up",
      target: "Warm-up · 20 kg × 10",
    })
  })

  it("falls back to the next set when the set number is not in the detail", () => {
    expect(restOverLines({ label: "Walk", detail: "15 min" }, true)).toEqual({
      title: "Rest over · time for the next set",
      target: "15 min",
    })
  })
})
