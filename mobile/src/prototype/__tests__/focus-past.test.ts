// Logging a focus session afterwards: it is written as ordinary session and
// segment rows, so the day's focus counts it; it may not reach into the
// future or overlap another session; it can be edited and deleted.
import type { FocusSession } from "@domain/focus/data"
import * as P from "@domain/focus/past"
import { focusStore } from "@domain/focus/store"
import { configureStorage, resetAll } from "@domain/lib/store"

const MIN = 60_000
const NOW = Date.parse("2026-10-20T12:00:00.000Z")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  focusStore.set((s) => ({ ...s, sessions: [], segments: [] }))
  jest.useFakeTimers({ now: NOW })
})
afterEach(() => jest.useRealTimers())

it("a focus block counts its whole span as focus", () => {
  const start = NOW - 90 * MIN
  const id = P.savePastSession({
    kind: "focus",
    start,
    end: start + 50 * MIN,
    label: "  Reading ",
  })!
  const x = focusStore.get().sessions.find((s) => s.id === id)!
  // 50 minutes = 3,000 s.
  expect(x).toMatchObject({
    source: "manual",
    label: "Reading",
    mode: "stopwatch",
    focusSec: 3000,
    endReason: "completed",
  })
  expect(
    focusStore.get().segments.filter((g) => g.sessionId === id),
  ).toHaveLength(1)
})

it("Pomodoros lay out sets and breaks and count every set", () => {
  // 3 × 25 min with two 5-min breaks: 85 min, 4,500 s of focus.
  const start = NOW - 120 * MIN
  const input: P.PastInput = {
    kind: "pomodoro",
    start,
    count: 3,
    preset: "25-5",
  }
  expect(P.pastWindow(input)).toEqual({ start, end: start + 85 * MIN })
  const id = P.savePastSession(input)!
  const x = focusStore.get().sessions.find((s) => s.id === id)!
  expect(x.focusSec).toBe(4500)
  expect(x.setsCompleted).toBe(3)
  const kinds = focusStore
    .get()
    .segments.filter((g) => g.sessionId === id)
    .map((g) => g.kind)
  expect(kinds).toEqual(["focus", "break", "focus", "break", "focus"])
})

it("a long break follows every 4th Classic set", () => {
  // 5 sets: f b f b f b f LONG f → 5×25 + 3×5 + 15 = 155 min.
  const w = P.pastWindow({
    kind: "pomodoro",
    start: 0,
    count: 5,
    preset: "25-5",
  })
  expect(w.end).toBe(155 * MIN)
})

it("refuses the future, an end before the start and a bad count", () => {
  const s = focusStore.get()
  expect(
    P.pastErrors(s, { kind: "focus", start: NOW + MIN, end: NOW + 2 * MIN })
      .start,
  ).toBeTruthy()
  expect(
    P.pastErrors(s, { kind: "focus", start: NOW - MIN, end: NOW - 2 * MIN })
      .end,
  ).toBe("End after it starts")
  expect(
    P.pastErrors(s, { kind: "focus", start: NOW - MIN, end: NOW + MIN }).end,
  ).toBe("That's in the future")
  // 3 Pomodoros started 30 min ago end 55 min from now.
  expect(
    P.pastErrors(s, { kind: "pomodoro", start: NOW - 30 * MIN, count: 3 }).end,
  ).toMatch(/after now/)
  expect(
    P.pastErrors(s, { kind: "pomodoro", start: NOW - 900 * MIN, count: 13 })
      .count,
  ).toBeTruthy()
  expect(
    P.savePastSession({ kind: "focus", start: NOW + MIN, end: NOW + 2 * MIN }),
  ).toBeNull()
  expect(focusStore.get().sessions).toHaveLength(0)
})

it("names the session it would overlap and refuses to save", () => {
  const start = NOW - 120 * MIN
  P.savePastSession({
    kind: "focus",
    start,
    end: start + 60 * MIN,
    label: "Deep work",
  })
  const clash: P.PastInput = {
    kind: "focus",
    start: start + 30 * MIN,
    end: start + 90 * MIN,
  }
  expect(P.pastErrors(focusStore.get(), clash).overlap).toMatch(/Deep work/)
  expect(P.savePastSession(clash)).toBeNull()
  // Touching end to start is not an overlap.
  expect(
    P.pastOk(
      P.pastErrors(focusStore.get(), {
        kind: "focus",
        start: start + 60 * MIN,
        end: start + 70 * MIN,
      }),
    ),
  ).toBe(true)
})

it("edits in place and is not refused for overlapping itself", () => {
  const start = NOW - 120 * MIN
  const id = P.savePastSession({ kind: "focus", start, end: start + 30 * MIN })!
  const input = P.pastInputOf(focusStore.get(), id)!
  expect(input).toMatchObject({ kind: "focus", start, end: start + 30 * MIN })
  expect(P.savePastSession({ ...input, end: start + 45 * MIN }, id)).toBe(id)
  const all = focusStore.get()
  expect(all.sessions).toHaveLength(1)
  expect(all.sessions[0].focusSec).toBe(45 * 60)
  expect(all.segments.filter((g) => g.sessionId === id)).toHaveLength(1)
})

it("deletes with everything it holds, and puts it back for Undo", () => {
  const start = NOW - 120 * MIN
  const id = P.savePastSession({ kind: "pomodoro", start, count: 2 })!
  const taken = P.takeSession(id)!
  expect(focusStore.get().sessions).toHaveLength(0)
  expect(focusStore.get().segments).toHaveLength(0)
  P.putBackSession(taken)
  expect(focusStore.get().sessions.map((s: FocusSession) => s.id)).toEqual([id])
  expect(focusStore.get().segments).toHaveLength(3)
})

it("only a logged session opens in the editor", () => {
  focusStore.set((s) => ({
    ...s,
    sessions: [
      {
        id: "t",
        mode: "pomodoro",
        focusMin: 25,
        shortBreakMin: 5,
        longBreakMin: 15,
        setsBeforeLong: 4,
        autoStartBreaks: true,
        autoStartFocus: true,
        startedAt: new Date(NOW - 60 * MIN).toISOString(),
        endedAt: new Date(NOW - 30 * MIN).toISOString(),
        focusSec: 1500,
        setsCompleted: 1,
      },
    ],
  }))
  expect(P.pastInputOf(focusStore.get(), "t")).toBeNull()
})
