import { expect, test } from "bun:test"
import { isEvening } from "./day"

const at = (hm: string) => new Date(`2026-09-28T${hm}:00`)

test("isEvening follows the configured start and ends at the day boundary", () => {
  expect(isEvening(at("17:59"), "18:00")).toBe(false)
  expect(isEvening(at("18:00"), "18:00")).toBe(true)
  expect(isEvening(at("20:29"), "20:30")).toBe(false)
  expect(isEvening(at("23:59"), "20:30")).toBe(true)
  expect(isEvening(at("01:30"), "18:00")).toBe(true) // still "yesterday"
  expect(isEvening(at("04:00"), "18:00")).toBe(false) // new day
})
