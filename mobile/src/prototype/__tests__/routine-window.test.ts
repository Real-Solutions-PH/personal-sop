// A routine shows on Today in its part of the day: around its time when it
// has one, from its name when it doesn't, else all day.
import type { Routine } from "@domain/habits/data"
import {
  businessMinute,
  routineShowsAt,
  routineWindow,
} from "@domain/habits/logic"

const day = "2026-10-22"
const routine = (name: string, time?: string, minutes = 30): Routine => ({
  id: name,
  name,
  icon: "🌅",
  schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], ...(time ? { time } : {}) }],
  reminder: false,
  steps: [{ habitId: "h", minutes }],
  status: "active",
  createdAt: "2026-01-01",
})
const at = (hh: number, mm = 0) => hh * 60 + mm

test("a timed routine shows from 90 minutes before until 2 hours after it ends", () => {
  const morning = routine("Morning routine", "09:00", 60)
  expect(routineWindow(morning, day)).toEqual([at(7, 30), at(12)])
  expect(routineShowsAt(morning, day, at(7, 29))).toBe(false)
  expect(routineShowsAt(morning, day, at(8))).toBe(true)
  expect(routineShowsAt(morning, day, at(21))).toBe(false)
  const evening = routine("Evening routine", "21:00", 50)
  expect(routineShowsAt(evening, day, at(9))).toBe(false)
  expect(routineShowsAt(evening, day, at(20))).toBe(true)
})

test("an untimed routine takes its part of the day from its name", () => {
  expect(routineShowsAt(routine("Morning"), day, at(6))).toBe(true)
  expect(routineShowsAt(routine("Morning"), day, at(18))).toBe(false)
  expect(routineShowsAt(routine("Night wind-down"), day, at(23))).toBe(true)
  // 01:30 before the 04:00 rollover is still that evening.
  expect(routineShowsAt(routine("Night wind-down"), day, at(25, 30))).toBe(true)
  expect(routineWindow(routine("Stretch"), day)).toBeNull()
  expect(routineShowsAt(routine("Stretch"), day, at(3))).toBe(true)
})

test("past midnight counts on from 24:00 until the day rolls over", () => {
  expect(businessMinute(new Date(2026, 9, 23, 1, 30))).toBe(at(25, 30))
  expect(businessMinute(new Date(2026, 9, 22, 5, 0))).toBe(at(5))
})
