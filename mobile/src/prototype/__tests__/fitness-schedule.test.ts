import {
  isRestDay,
  scheduledTemplate,
  scheduleIndex,
  weeklyGoal,
} from "@domain/fitness/calc"
import type { FitnessState, WeekSchedule } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"

// Week of 2026-10-26: Mon 26 … Sun Nov 1.
const MON = "2026-10-26"
const WED = "2026-10-28"
const SUN = "2026-11-01"

const stateWith = (schedule: WeekSchedule): FitnessState => ({
  ...fitStore.get(),
  templates: [
    { id: "upper", name: "Upper", items: [] },
    { id: "lower", name: "Lower", items: [] },
  ],
  schedule,
})

// Upper, Lower, rest, Upper, Lower, rest, rest.
const plan: WeekSchedule = [
  "upper",
  "lower",
  null,
  "upper",
  "lower",
  null,
  null,
]

test("scheduleIndex is Monday-first", () => {
  expect(scheduleIndex(MON)).toBe(0)
  expect(scheduleIndex(WED)).toBe(2)
  expect(scheduleIndex(SUN)).toBe(6)
})

test("scheduledTemplate returns the day's template on a training day", () => {
  expect(scheduledTemplate(stateWith(plan), MON)?.name).toBe("Upper")
})

test("scheduledTemplate is undefined on a rest day", () => {
  const s = stateWith(plan)
  expect(scheduledTemplate(s, WED)).toBeUndefined()
  expect(isRestDay(s, WED)).toBe(true)
  expect(isRestDay(s, MON)).toBe(false)
})

test("scheduledTemplate is undefined when the slot points at a deleted template", () => {
  const s = stateWith(["gone", null, null, null, null, null, null])
  expect(scheduledTemplate(s, MON)).toBeUndefined()
  // A dangling id is still a training day, not a rest day.
  expect(isRestDay(s, MON)).toBe(false)
})

test("weeklyGoal counts training days, else falls back to weeklyTarget", () => {
  expect(weeklyGoal(stateWith(plan))).toBe(4)
  const allRest = stateWith(Array(7).fill(null))
  expect(weeklyGoal(allRest)).toBe(allRest.settings.weeklyTarget)
})
