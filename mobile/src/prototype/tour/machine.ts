// The first-run guided tour as a pure state machine: which step is showing,
// what finishes it, and what the funnel records. No React, no stores; the
// overlay and the watcher (tour/overlay.tsx) feed it what the app observed.
//
// Rule: a step finishes when the person does the thing it teaches (sends
// Fern a message, ticks a habit or task, opens Plan or Stats, opens their
// reminder settings). There is no Next button: every step can be skipped,
// and "Skip tour" ends the whole tour, but neither counts as done.

export const TOUR_STEPS = ["fern", "tick", "plan", "stats", "remind"] as const
export type TourStepId = (typeof TOUR_STEPS)[number]

/** What the app saw happen. */
export type TourSignal =
  /** A message went to Fern (typed, spoken or a photo). */
  | { kind: "logged" }
  /** A habit or task was ticked, anywhere. */
  | { kind: "ticked" }
  /** The route changed. */
  | { kind: "opened"; path: string }
  /** Reminders were switched on (the system said yes). */
  | { kind: "reminders" }

export type TourEvent =
  /** First run, or "Replay the tour" from Me → Help. */
  | { type: "start" }
  | { type: "signal"; signal: TourSignal }
  | { type: "skipStep" }
  | { type: "skipTour" }
  /** The current step has nothing to act on (no habit or task to tick). */
  | { type: "unavailable"; step: TourStepId }

export type TourState = {
  status: "idle" | "running" | "finished"
  /** The step showing, while running. */
  index: number
  done: TourStepId[]
  skipped: TourStepId[]
  ended: "completed" | "skipped" | null
}

/** One line for the funnel: a step was shown, done or skipped. */
export type TourNote = {
  step: TourStepId
  outcome: "view" | "done" | "skip"
}

export const IDLE: TourState = {
  status: "idle",
  index: 0,
  done: [],
  skipped: [],
  ended: null,
}

/** A route is ``base`` or a page inside it, never a longer name. */
const under = (path: string, base: string) =>
  path === base || path.startsWith(`${base}/`)

/** Whether ``signal`` is the action ``step`` teaches. */
export function completes(step: TourStepId, signal: TourSignal): boolean {
  switch (step) {
    case "fern":
      return signal.kind === "logged"
    case "tick":
      return signal.kind === "ticked"
    case "plan":
      return signal.kind === "opened" && under(signal.path, "/plan")
    case "stats":
      return signal.kind === "opened" && under(signal.path, "/stats")
    case "remind":
      return (
        signal.kind === "reminders" ||
        (signal.kind === "opened" && under(signal.path, "/me/settings"))
      )
  }
}

/** The step showing, or null when the tour is not running. */
export const currentStep = (s: TourState): TourStepId | null =>
  s.status === "running" ? (TOUR_STEPS[s.index] ?? null) : null

/** Leaves the current step (done or skipped) and shows the next, or ends. */
function leave(
  s: TourState,
  outcome: "done" | "skip",
): { state: TourState; notes: TourNote[] } {
  const step = TOUR_STEPS[s.index]
  const notes: TourNote[] = [{ step, outcome }]
  const done = outcome === "done" ? [...s.done, step] : s.done
  const skipped = outcome === "skip" ? [...s.skipped, step] : s.skipped
  const index = s.index + 1
  if (index >= TOUR_STEPS.length)
    return {
      state: { status: "finished", index, done, skipped, ended: "completed" },
      notes,
    }
  notes.push({ step: TOUR_STEPS[index], outcome: "view" })
  return {
    state: { status: "running", index, done, skipped, ended: null },
    notes,
  }
}

export function tourReducer(
  s: TourState,
  e: TourEvent,
): { state: TourState; notes: TourNote[] } {
  const same = { state: s, notes: [] }
  if (e.type === "start") {
    if (s.status === "running") return same
    return {
      state: { ...IDLE, status: "running" },
      notes: [{ step: TOUR_STEPS[0], outcome: "view" }],
    }
  }
  const step = currentStep(s)
  if (!step) return same
  switch (e.type) {
    case "signal":
      return completes(step, e.signal) ? leave(s, "done") : same
    case "skipStep":
      return leave(s, "skip")
    case "unavailable":
      return e.step === step ? leave(s, "skip") : same
    case "skipTour": {
      const rest = TOUR_STEPS.slice(s.index)
      return {
        state: {
          status: "finished",
          index: TOUR_STEPS.length,
          done: s.done,
          skipped: [...s.skipped, ...rest],
          ended: "skipped",
        },
        notes: rest.map((x) => ({ step: x, outcome: "skip" as const })),
      }
    }
  }
}
