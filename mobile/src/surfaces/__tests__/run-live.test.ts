// A run beside a workout and a focus session: one Live Activity whose main
// session is the workout (it holds the Live slot), with the run and focus
// listed under it; a run alone is the main one. Lock-screen pause and
// resume reach the run.
import * as A from "@domain/fitness/actions"
import * as RL from "@domain/fitness/run-live"
import { fitStore } from "@domain/fitness/store"
import * as FO from "@domain/focus/actions"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { liveStore } from "@domain/lib/live"
import { configureStorage, resetAll } from "@domain/lib/store"
import { applySurfaceAction } from "../actions"
import { buildAllLive } from "../live-state"
import { isAction } from "../native"

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

const all = (now = Date.now()) =>
  buildAllLive({
    live: liveStore.get().live,
    habits: habitsStore.get(),
    fit: fitStore.get(),
    focus: focusStore.get(),
    run: RL.runLiveStore.get().active,
    now,
  })

it("a run alone is the main session, with moving time as its clock", () => {
  const t0 = Date.now() - 600_000
  RL.startRun("run", t0)
  RL.pauseRun(t0 + 300_000)
  RL.resumeRun(t0 + 360_000)
  const now = t0 + 600_000
  const s = all(now)!
  expect(s.kind).toBe("run")
  expect(s.title).toBe("Run")
  expect(s.controls).toEqual(["pause"])
  // 600 s since the start, 60 paused: the clock's zero is 540 s back.
  expect(s.elapsedSec).toBe(540)
  expect(s.startedAt).toBe(now - 540_000)
  expect(s.others).toBeUndefined()
})

it("a workout keeps the main place; the run and focus are listed under it", () => {
  expect(A.startWorkout({ from: "empty" }).ok).toBe(true)
  RL.startRun("walk")
  FO.startFocus({ mode: "stopwatch" })
  const s = all()!
  expect(s.kind).toBe("workout")
  // Focus draws as a timer on the lock screen.
  expect((s.others ?? []).map((o) => o.kind)).toEqual(["run", "timer"])
  expect(s.others?.[0]).toMatchObject({ title: "Walk", paused: false })
})

it("lock-screen pause and resume reach the run, stale taps are dropped", () => {
  const r = RL.startRun("run")
  const tap = (type: "pause" | "resume", target = r.id) =>
    applySurfaceAction({ id: type, type, kind: "run", target, at: Date.now() })
  expect(tap("resume")).toBe("stale")
  expect(tap("pause")).toBe("applied")
  expect(RL.isPaused(RL.runLiveStore.get().active!)).toBe(true)
  expect(tap("pause")).toBe("stale")
  expect(tap("resume", "other-run")).toBe("stale")
  expect(tap("resume")).toBe("applied")
  expect(RL.isPaused(RL.runLiveStore.get().active!)).toBe(false)
})

it("a queued run tap passes the native action check", () => {
  expect(
    isAction({ id: "a", type: "pause", kind: "run", target: "r", at: 1 }),
  ).toBe(true)
})
