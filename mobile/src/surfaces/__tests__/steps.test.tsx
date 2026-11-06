// The Steps widgets' count comes from the same Apple Health read the Steps
// card makes, only once Health's sheet was answered, and a failed read keeps
// the last count instead of dropping to 0.

import { act, renderHook } from "@testing-library/react-native"
import { useTodaySteps } from "../steps"

const mockHealth = {
  available: true,
  asked: true,
  days: [{ steps: 4200, activeKcal: 0, distanceKm: 0 }] as unknown[],
}
jest.mock("@/prototype/health", () => ({
  healthAvailable: () => mockHealth.available,
  healthAsked: async () => mockHealth.asked,
  localDay: () => "2026-11-06",
  readDays: async () => mockHealth.days,
}))

beforeEach(() => {
  mockHealth.available = true
  mockHealth.asked = true
  mockHealth.days = [{ steps: 4200, activeKcal: 0, distanceKm: 0 }]
})

const settle = () => act(async () => {})

it("reads today's steps from Health", async () => {
  const { result } = renderHook(() => useTodaySteps(0))
  await settle()
  expect(result.current).toEqual({ day: "2026-11-06", count: 4200 })
})

it("is null until Health's sheet is answered", async () => {
  mockHealth.asked = false
  const { result } = renderHook(() => useTodaySteps(0))
  await settle()
  expect(result.current).toBeNull()
})

it("is null with no Health on this device", async () => {
  mockHealth.available = false
  const { result } = renderHook(() => useTodaySteps(0))
  await settle()
  expect(result.current).toBeNull()
})

it("reads again on the next five-minute slot, and keeps the count when a read fails", async () => {
  const { result, rerender } = renderHook(
    ({ minute }: { minute: number }) => useTodaySteps(minute),
    { initialProps: { minute: 0 } },
  )
  await settle()
  mockHealth.days = [{ steps: 5100, activeKcal: 0, distanceKm: 0 }]
  rerender({ minute: 4 })
  await settle()
  expect(result.current?.count).toBe(4200)
  rerender({ minute: 5 })
  await settle()
  expect(result.current?.count).toBe(5100)
  mockHealth.days = [null]
  rerender({ minute: 10 })
  await settle()
  expect(result.current?.count).toBe(5100)
})
