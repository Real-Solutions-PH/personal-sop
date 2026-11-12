import {
  completes,
  IDLE,
  TOUR_STEPS,
  type TourEvent,
  type TourState,
  tourReducer,
} from "../tour/machine"

const run = (events: TourEvent[], from: TourState = IDLE) => {
  let state = from
  const notes: { step: string; outcome: string }[] = []
  for (const e of events) {
    const r = tourReducer(state, e)
    state = r.state
    notes.push(...r.notes)
  }
  return { state, notes }
}

describe("tour steps", () => {
  it("is at most six steps, Fern first and reminders last", () => {
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(6)
    expect(TOUR_STEPS[0]).toBe("fern")
    expect(TOUR_STEPS[TOUR_STEPS.length - 1]).toBe("remind")
  })
})

describe("completion rules: the action, not a Next tap", () => {
  it.each([
    ["fern", { kind: "logged" }, true],
    ["fern", { kind: "ticked" }, false],
    ["fern", { kind: "opened", path: "/capture" }, false],
    ["tick", { kind: "ticked" }, true],
    ["tick", { kind: "logged" }, false],
    ["plan", { kind: "opened", path: "/plan" }, true],
    ["plan", { kind: "opened", path: "/plan/day" }, true],
    ["plan", { kind: "opened", path: "/planner" }, false],
    ["plan", { kind: "opened", path: "/today" }, false],
    ["stats", { kind: "opened", path: "/stats" }, true],
    ["stats", { kind: "opened", path: "/stats/goals" }, true],
    ["stats", { kind: "opened", path: "/statsx" }, false],
    ["remind", { kind: "opened", path: "/me/settings" }, true],
    ["remind", { kind: "opened", path: "/me" }, false],
    ["remind", { kind: "reminders" }, true],
    ["remind", { kind: "ticked" }, false],
  ] as const)("%s completes on %j: %s", (step, signal, expected) => {
    expect(completes(step, signal)).toBe(expected)
  })
})

describe("tourReducer", () => {
  it("starts on the first step and records its view", () => {
    const { state, notes } = run([{ type: "start" }])
    expect(state.status).toBe("running")
    expect(state.index).toBe(0)
    expect(notes).toEqual([{ step: "fern", outcome: "view" }])
  })

  it("moves on only when the current step's action happens", () => {
    const { state, notes } = run([
      { type: "start" },
      { type: "signal", signal: { kind: "ticked" } },
      { type: "signal", signal: { kind: "opened", path: "/stats" } },
    ])
    expect(state.index).toBe(0)
    expect(state.done).toEqual([])
    expect(notes).toEqual([{ step: "fern", outcome: "view" }])
  })

  it("an action for a later step does not complete it early", () => {
    const { state } = run([
      { type: "start" },
      { type: "signal", signal: { kind: "opened", path: "/stats" } },
      { type: "signal", signal: { kind: "logged" } },
    ])
    expect(state.index).toBe(1)
    expect(state.done).toEqual(["fern"])
  })

  it("runs to the end when every action is done", () => {
    const { state, notes } = run([
      { type: "start" },
      { type: "signal", signal: { kind: "logged" } },
      { type: "signal", signal: { kind: "ticked" } },
      { type: "signal", signal: { kind: "opened", path: "/plan" } },
      { type: "signal", signal: { kind: "opened", path: "/stats" } },
      { type: "signal", signal: { kind: "reminders" } },
    ])
    expect(state.status).toBe("finished")
    expect(state.ended).toBe("completed")
    expect(state.done).toEqual([...TOUR_STEPS])
    expect(state.skipped).toEqual([])
    expect(
      notes.filter((n) => n.outcome === "done").map((n) => n.step),
    ).toEqual([...TOUR_STEPS])
    expect(notes.filter((n) => n.outcome === "view")).toHaveLength(
      TOUR_STEPS.length,
    )
  })

  it("skipping a step moves to the next and records the skip", () => {
    const { state, notes } = run([{ type: "start" }, { type: "skipStep" }])
    expect(state.index).toBe(1)
    expect(state.skipped).toEqual(["fern"])
    expect(notes).toEqual([
      { step: "fern", outcome: "view" },
      { step: "fern", outcome: "skip" },
      { step: "tick", outcome: "view" },
    ])
  })

  it("skipping the last step finishes the tour as completed", () => {
    const toLast: TourEvent[] = [
      { type: "start" },
      ...TOUR_STEPS.slice(0, -1).map(() => ({ type: "skipStep" }) as const),
    ]
    const { state } = run([...toLast, { type: "skipStep" }])
    expect(state.status).toBe("finished")
    expect(state.ended).toBe("completed")
  })

  it("skip tour ends it and records every step not yet done as skipped", () => {
    const { state, notes } = run([
      { type: "start" },
      { type: "signal", signal: { kind: "logged" } },
      { type: "skipTour" },
    ])
    expect(state.status).toBe("finished")
    expect(state.ended).toBe("skipped")
    expect(state.done).toEqual(["fern"])
    expect(state.skipped).toEqual(["tick", "plan", "stats", "remind"])
    expect(
      notes.filter((n) => n.outcome === "skip").map((n) => n.step),
    ).toEqual(["tick", "plan", "stats", "remind"])
  })

  it("a step with nothing to act on is passed over as skipped", () => {
    const { state, notes } = run([
      { type: "start" },
      { type: "signal", signal: { kind: "logged" } },
      { type: "unavailable", step: "tick" },
    ])
    expect(state.index).toBe(2)
    expect(state.skipped).toEqual(["tick"])
    expect(notes.slice(-2)).toEqual([
      { step: "tick", outcome: "skip" },
      { step: "plan", outcome: "view" },
    ])
  })

  it("ignores 'unavailable' for a step that is not the current one", () => {
    const { state } = run([
      { type: "start" },
      { type: "unavailable", step: "tick" },
    ])
    expect(state.index).toBe(0)
    expect(state.skipped).toEqual([])
  })

  it("ignores everything but start while idle or finished", () => {
    const idle = run([
      { type: "signal", signal: { kind: "logged" } },
      { type: "skipStep" },
      { type: "skipTour" },
    ])
    expect(idle.state).toEqual(IDLE)
    expect(idle.notes).toEqual([])
    const finished = run([{ type: "start" }, { type: "skipTour" }]).state
    const after = run(
      [{ type: "signal", signal: { kind: "logged" } }],
      finished,
    )
    expect(after.state).toEqual(finished)
    expect(after.notes).toEqual([])
  })

  it("replay starts again from the first step with a clean record", () => {
    const finished = run([{ type: "start" }, { type: "skipTour" }]).state
    const { state, notes } = run([{ type: "start" }], finished)
    expect(state).toEqual({
      status: "running",
      index: 0,
      done: [],
      skipped: [],
      ended: null,
    })
    expect(notes).toEqual([{ step: "fern", outcome: "view" }])
  })

  it("start while running is a no-op", () => {
    const running = run([
      { type: "start" },
      { type: "signal", signal: { kind: "logged" } },
    ])
    const again = run([{ type: "start" }], running.state)
    expect(again.state).toEqual(running.state)
    expect(again.notes).toEqual([])
  })
})
