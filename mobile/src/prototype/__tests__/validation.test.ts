import { displayMass, kilograms } from "../units"
import { isDay } from "../validation"

test("calendar dates reject rollover and accept leap days", () => {
  expect(isDay("2026-02-30")).toBe(false)
  expect(isDay("2024-02-29")).toBe(true)
  expect(isDay("2026-13-01")).toBe(false)
  expect(isDay("")).toBe(false)
})
test("pound input retains kilograms as the stored unit", () => {
  expect(kilograms(220.46226218, "lb")).toBeCloseTo(100, 5)
  expect(displayMass(100, "lb")).toBe(220.5)
  expect(kilograms(100, "kg")).toBe(100)
})
