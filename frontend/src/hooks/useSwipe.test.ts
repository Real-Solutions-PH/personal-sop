import { expect, test } from "bun:test"
import { axisOf, passed } from "./useSwipe"

test("axis locks only past the slop, on the dominant direction", () => {
  expect(axisOf(3, -5)).toBeNull()
  expect(axisOf(12, 4)).toBe("x")
  expect(axisOf(-4, 9)).toBe("y")
})

test("passed: distance, or a flick the same way", () => {
  expect(passed(100, 0, 90)).toBe(true)
  expect(passed(-30, -0.8, 90)).toBe(true)
  expect(passed(30, -0.8, 90)).toBe(false) // flicked back
  expect(passed(30, 0.2, 90)).toBe(false)
})
