// Patterns across areas: on days with a driver (7h+ sleep, a workout, 10,000
// steps) vs days without, how mood and habit completion differ. Only shown
// with enough days on each side and a real gap.
import { findInsights, type InsightDay } from "../insights"

const days = (n: number, f: (i: number) => Partial<InsightDay>): InsightDay[] =>
  Array.from({ length: n }, (_, i) => ({
    day: `2026-10-${String(i + 1).padStart(2, "0")}`,
    sleepMin: null,
    workout: false,
    steps: null,
    mood: undefined,
    habits: null,
    ...f(i),
  }))

test("good sleep with better mood: one sentence, both averages", () => {
  const d = days(12, (i) =>
    i % 2
      ? { sleepMin: 480, mood: 4 + (i % 4 === 1 ? 1 : 0) }
      : { sleepMin: 360, mood: 3 },
  )
  expect(findInsights(d)).toEqual([
    {
      id: "sleep-mood",
      text: "After 7h+ of sleep, your mood averages 4.5/5, vs 3.0 after shorter nights.",
      gap: 1.5 / 4,
    },
  ])
})

test("workout days and habits, in percent", () => {
  const d = days(10, (i) =>
    i < 5 ? { workout: true, habits: 0.9 } : { habits: 0.6 },
  )
  expect(findInsights(d).map((x) => x.text)).toEqual([
    "On days you work out, you finish 90% of your habits, vs 60% on days you don't.",
  ])
})

test("a gap the other way reads the same, numbers tell the direction", () => {
  const d = days(10, (i) =>
    i < 5 ? { steps: 12000, mood: 2 } : { steps: 3000, mood: 4 },
  )
  expect(findInsights(d)[0]?.text).toBe(
    "On 10,000-step days, your mood averages 2.0/5, vs 4.0 on other days.",
  )
})

test("fewer than 5 days on either side: nothing", () => {
  const d = days(9, (i) =>
    i < 4 ? { workout: true, habits: 1 } : { habits: 0.2 },
  )
  expect(findInsights(d)).toEqual([])
})

test("a small gap: nothing", () => {
  const d = days(12, (i) =>
    i % 2 ? { sleepMin: 480, mood: 4 } : { sleepMin: 360, mood: 4 },
  )
  expect(findInsights(d)).toEqual([])
})

test("untracked sleep and steps are neither side; days without the outcome don't count", () => {
  const d = days(15, (i) =>
    i < 5
      ? { sleepMin: 480, mood: 5 }
      : i < 10
        ? { sleepMin: null, mood: 1 }
        : { sleepMin: 0, mood: 1 },
  )
  // 5 tracked good nights, 0 tracked short nights: no comparison.
  expect(findInsights(d)).toEqual([])
})

test("at most three, biggest gap first", () => {
  const d = days(20, (i) => {
    const good = i % 2 === 0
    return {
      sleepMin: good ? 480 : 300,
      workout: good,
      steps: good ? 11000 : 2000,
      mood: good ? 5 : 3,
      habits: good ? 0.9 : 0.5,
    }
  })
  const found = findInsights(d)
  expect(found).toHaveLength(3)
  expect(found.map((x) => x.gap)).toEqual(
    [...found.map((x) => x.gap)].sort((a, b) => b - a),
  )
})
