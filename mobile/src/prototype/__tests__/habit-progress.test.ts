// The habit check's progress ring: counts and minutes fill toward their
// target, a plain check is all or nothing, and done is always full.
import type { Habit, HabitLog } from "@domain/habits/data"
import { progressOf } from "@domain/habits/logic"

const habit = (h: Partial<Habit>): Habit =>
  ({ id: "h", name: "Water", icon: "💧", type: "count", ...h }) as Habit
const log = (l: Partial<HabitLog>): HabitLog =>
  ({ habitId: "h", day: "2026-10-22", status: "not_reached", ...l }) as HabitLog

test("a count fills toward its target", () => {
  expect(progressOf(habit({ target: 2 }), log({ value: 1 }))).toBe(0.5)
  expect(progressOf(habit({ target: 8 }), log({ value: 6 }))).toBe(0.75)
  expect(progressOf(habit({ target: 2 }), log({ value: 5 }))).toBe(1)
})

test("minutes fill toward the timed target", () => {
  const meditate = habit({ type: "duration", target: 10 })
  expect(progressOf(meditate, log({ value: 4 }))).toBe(0.4)
})

test("no log is empty, done is full, a plain check has no partial", () => {
  expect(progressOf(habit({ target: 2 }))).toBe(0)
  expect(progressOf(habit({ target: 2 }), log({ status: "done" }))).toBe(1)
  expect(progressOf(habit({ type: "check" }), log({ value: 1 }))).toBe(0)
})

// A habit driven by screen time fills with the day, not with taps.
test("a screen-time rule: done is full, tracking fills, broken and untracked are empty", () => {
  const rule = habit({
    type: "check",
    rule: { kind: "screen_limit", groupId: "g", maxMin: 30 },
  })
  const tracking = { kind: "tracking", usedMin: 15, progress: 0.4 } as const
  expect(progressOf(rule, log({ status: "done" }), tracking)).toBe(1)
  expect(progressOf(rule, undefined, tracking)).toBe(0.4)
  expect(
    progressOf(rule, undefined, { kind: "broken", usedMin: 45, overMin: 15 }),
  ).toBe(0)
  expect(progressOf(rule, undefined, { kind: "untracked" })).toBe(0)
  expect(progressOf(rule)).toBe(0)
})
