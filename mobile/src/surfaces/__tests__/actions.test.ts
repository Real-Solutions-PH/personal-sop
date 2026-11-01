// Lock-screen, notification and widget taps land in the same store actions
// the in-app buttons call, and a tap meant for a step the app has already
// left is dropped instead of advancing the wrong one.
import * as FA from "@domain/fitness/actions"
import { isDone } from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import * as HA from "@domain/habits/actions"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { applySurfaceAction, applySurfaceActions } from "../actions"
import { buildLiveState } from "../live-state"
import { isAction } from "../native"
import type { SurfaceAction } from "../types"

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

let n = 0
const tap = (a: Omit<SurfaceAction, "id" | "at"> & { at?: number }) =>
  ({ id: `tap-${++n}`, at: Date.now(), ...a }) as SurfaceAction

const state = () =>
  buildLiveState({
    live: liveStore.get().live,
    habits: habitsStore.get(),
    fit: fitStore.get(),
  })

function startARoutine() {
  const r = habitsStore
    .get()
    .routines.find((x) => x.status === "active" && x.steps.length >= 3)
  if (!r) throw new Error("seed has no routine with three steps")
  const run = HA.startRoutine(r.id)
  if (!run) throw new Error("routine did not start")
  return run
}
const runById = (id: string) => habitsStore.get().runs.find((r) => r.id === id)

describe("routine", () => {
  it("done on the lock screen completes the step and logs its habit", () => {
    const run = startARoutine()
    const live = state()
    expect(live).toMatchObject({ kind: "routine", id: run.id, key: "0" })
    const habitId = run.steps[0].habitId
    expect(
      applySurfaceAction(
        tap({ type: "done", kind: "routine", target: run.id, key: "0" }),
      ),
    ).toBe("applied")
    expect(runById(run.id)?.current).toBe(1)
    expect(runById(run.id)?.results[0]).toMatchObject({
      habitId,
      status: "done",
    })
    const log = habitsStore
      .get()
      .logs.find((l) => l.habitId === habitId && l.day === dayKey())
    expect(log?.source).toBe("routine")
    expect(state()?.key).toBe("1")
  })

  it("the same tap delivered twice advances once", () => {
    const run = startARoutine()
    const a = tap({ type: "skip", kind: "routine", target: run.id, key: "0" })
    expect(applySurfaceActions([a, { ...a, id: "again" }])).toBe(1)
    expect(runById(run.id)?.current).toBe(1)
    expect(runById(run.id)?.results[0]?.status).toBe("skipped")
  })

  it("a tap for a step the app already left is dropped", () => {
    const run = startARoutine()
    HA.stepDone(run)
    expect(
      applySurfaceAction(
        tap({ type: "done", kind: "routine", target: run.id, key: "0" }),
      ),
    ).toBe("stale")
    expect(runById(run.id)?.current).toBe(1)
  })

  it("pause and resume follow the run, and repeat taps change nothing", () => {
    const run = startARoutine()
    const pause = tap({ type: "pause", kind: "routine", target: run.id })
    expect(applySurfaceAction(pause)).toBe("applied")
    expect(runById(run.id)?.pausedAt).toBeDefined()
    expect(liveStore.get().live?.pausedAt).toBeDefined()
    expect(state()).toMatchObject({ paused: true })
    expect(state()?.controls).toContain("resume")
    expect(applySurfaceAction({ ...pause, id: "again" })).toBe("stale")
    expect(
      applySurfaceAction(
        tap({ type: "resume", kind: "routine", target: run.id }),
      ),
    ).toBe("applied")
    expect(runById(run.id)?.pausedAt).toBeUndefined()
    expect(liveStore.get().live?.pausedAt).toBeUndefined()
  })

  it("the last step ends the run and the lock-screen activity", () => {
    const run = startARoutine()
    for (let i = 0; i < run.steps.length; i++)
      applySurfaceAction(
        tap({ type: "done", kind: "routine", target: run.id, key: String(i) }),
      )
    expect(runById(run.id)?.state).toBe("completed")
    expect(liveStore.get().live).toBeNull()
    expect(state()).toBeNull()
  })

  it("finish on the lock screen leaves the routine as the player's own finish does", () => {
    const run = startARoutine()
    expect(state()?.controls).toContain("finish")
    HA.stepDone(run)
    // Seen on step one, applied after the app moved on: dropped.
    expect(
      applySurfaceAction(
        tap({ type: "finish", kind: "routine", target: run.id, key: "0" }),
      ),
    ).toBe("stale")
    expect(liveStore.get().live?.kind).toBe("routine")
    expect(
      applySurfaceAction(
        tap({ type: "finish", kind: "routine", target: run.id, key: "1" }),
      ),
    ).toBe("applied")
    expect(liveStore.get().live).toBeNull()
    expect(state()).toBeNull()
  })

  it("a run that is no longer in progress ignores taps", () => {
    const run = startARoutine()
    HA.resetRoutine(run.routineId)
    expect(
      applySurfaceAction(
        tap({ type: "done", kind: "routine", target: run.id, key: "0" }),
      ),
    ).toBe("stale")
  })
})

describe("workout", () => {
  function start() {
    const t = fitStore.get().templates[0]
    const res = FA.startWorkout({ from: "template", templateId: t.id })
    if (!res.ok) throw new Error(res.reason)
    return res.workout
  }
  it("finish set completes the set the person saw and starts rest", () => {
    const w = start()
    const live = state()
    const [weId, setId] = (live?.key ?? "").split("/")
    expect(weId).toBe(w.exercises[0].id)
    expect(
      applySurfaceAction(
        tap({
          type: "finishSet",
          kind: "workout",
          target: w.id,
          key: live?.key,
        }),
      ),
    ).toBe("applied")
    const set = fitStore
      .get()
      .workouts.find((x) => x.id === w.id)
      ?.exercises.find((e) => e.id === weId)
      ?.sets.find((x) => x.id === setId)
    expect(set && isDone(set)).toBe(true)
    expect(fitStore.get().rest).not.toBeNull()
    // The lock screen moves to the next set (index counts working sets, so
    // a finished warm-up leaves it at 0).
    expect(state()?.key).not.toBe(live?.key)
    expect(state()?.index).toBe(set?.kind === "warmup" ? 0 : 1)
    // Resting: the lock screen offers the in-app rest buttons.
    expect(state()?.controls).toEqual([
      "subRest",
      "addRest",
      "skipRest",
      "finish",
    ])
    // Delivered again: the set is done already.
    expect(
      applySurfaceAction(
        tap({
          type: "finishSet",
          kind: "workout",
          target: w.id,
          key: live?.key,
        }),
      ),
    ).toBe("stale")
  })

  it("rest can be moved 15 seconds either way and skipped from the lock screen", () => {
    const w = start()
    FA.startRest(60)
    const ends = () => new Date(fitStore.get().rest?.endsAt ?? 0).getTime()
    const before = ends()
    expect(
      applySurfaceAction(
        tap({ type: "addRest", kind: "workout", target: w.id }),
      ),
    ).toBe("applied")
    expect(ends()).toBe(before + 15_000)
    expect(
      applySurfaceAction(
        tap({ type: "subRest", kind: "workout", target: w.id }),
      ),
    ).toBe("applied")
    expect(ends()).toBe(before)
    expect(fitStore.get().rest?.durationSec).toBe(60)
    expect(
      applySurfaceAction(
        tap({ type: "skipRest", kind: "workout", target: w.id }),
      ),
    ).toBe("applied")
    expect(fitStore.get().rest).toBeNull()
    expect(
      applySurfaceAction(
        tap({ type: "skipRest", kind: "workout", target: w.id }),
      ),
    ).toBe("stale")
  })

  it("finish ends the workout at the moment of the tap", () => {
    const w = start()
    const live = state()
    applySurfaceAction(
      tap({ type: "finishSet", kind: "workout", target: w.id, key: live?.key }),
    )
    const at = Date.now() - 5 * 60_000
    expect(
      applySurfaceAction(
        tap({ type: "finish", kind: "workout", target: w.id, at }),
      ),
    ).toBe("applied")
    const done = fitStore.get().workouts.find((x) => x.id === w.id)
    expect(done?.status).toBe("finished")
    expect(done?.endedAt).toBe(new Date(at).toISOString())
    expect(fitStore.get().activeId).toBeNull()
    expect(liveStore.get().live).toBeNull()
  })
})

describe("habit timer", () => {
  it("pause, resume and finish log the minutes up to the tap", () => {
    const h = habitsStore.get().habits.find((x) => x.status === "active")
    if (!h) throw new Error("no habit")
    HA.startTimer(h.id)
    liveStore.set((s) =>
      s.live
        ? {
            live: {
              ...s.live,
              startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
            },
          }
        : s,
    )
    expect(
      applySurfaceAction(tap({ type: "pause", kind: "timer", target: h.id })),
    ).toBe("applied")
    expect(liveStore.get().live?.pausedAt).toBeDefined()
    expect(
      applySurfaceAction(tap({ type: "pause", kind: "timer", target: h.id })),
    ).toBe("stale")
    applySurfaceAction(tap({ type: "resume", kind: "timer", target: h.id }))
    expect(liveStore.get().live?.pausedAt).toBeUndefined()
    expect(
      applySurfaceAction(tap({ type: "finish", kind: "timer", target: h.id })),
    ).toBe("applied")
    const log = habitsStore
      .get()
      .logs.find((l) => l.habitId === h.id && l.day === dayKey())
    expect(log?.source).toBe("timer")
    expect(log?.value).toBe(20)
    expect(liveStore.get().live).toBeNull()
  })
})

describe("widget habit check", () => {
  it("checks a habit once for the day the widget showed", () => {
    const h = habitsStore
      .get()
      .habits.find((x) => x.status === "active" && x.type === "check")
    if (!h) throw new Error("no check habit")
    HA.clearLog(h.id)
    const a = tap({ type: "checkHabit", target: h.id, key: dayKey() })
    expect(applySurfaceAction(a)).toBe("applied")
    expect(HA.alreadyLogged(h.id)).toBe(true)
    expect(applySurfaceAction({ ...a, id: "again" })).toBe("stale")
  })
})

describe("queued payloads", () => {
  it("rejects anything that is not a known action", () => {
    expect(
      isAction({ id: "1", type: "done", kind: "routine", target: "r", at: 1 }),
    ).toBe(true)
    expect(isAction({ id: "1", type: "explode", target: "r", at: 1 })).toBe(
      false,
    )
    expect(isAction({ id: "1", type: "done", target: "r", at: "1" })).toBe(
      false,
    )
    expect(
      isAction({ id: "1", type: "done", kind: "gym", target: "r", at: 1 }),
    ).toBe(false)
    expect(isAction(null)).toBe(false)
  })
  it("an action without a kind does nothing", () => {
    expect(applySurfaceAction(tap({ type: "done", target: "x" }))).toBe(
      "unknown",
    )
  })
})
