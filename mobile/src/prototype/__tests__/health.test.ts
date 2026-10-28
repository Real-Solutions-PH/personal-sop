// Reading a day's activity from Apple Health: sums over the device-local
// day, and nothing (null) whenever Health can't answer.
import { Platform } from "react-native"

const sums: Record<string, number> = {
  HKQuantityTypeIdentifierStepCount: 8412,
  HKQuantityTypeIdentifierActiveEnergyBurned: 431.6,
  HKQuantityTypeIdentifierDistanceWalkingRunning: 6.27,
}
const mockStats = jest.fn(async (id: string, _s: unknown, _o: unknown) => ({
  sumQuantity: { unit: "x", quantity: sums[id] ?? 0 },
}))
const mockWorkouts = jest.fn(async (_o: unknown) => [{}, {}])
const mockAuth = jest.fn(async (_t: unknown) => true)
let mockAvailable = true
jest.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: () => mockAvailable,
  requestAuthorization: (t: unknown) => mockAuth(t),
  queryStatisticsForQuantity: (id: string, s: unknown, o: unknown) =>
    mockStats(id, s, o),
  queryWorkoutSamples: (o: unknown) => mockWorkouts(o),
}))

import { connectHealth, healthAvailable, readActivity } from "../health"

beforeEach(() => {
  mockAvailable = true
  Platform.OS = "ios"
  jest.clearAllMocks()
})

test("sums the local day's steps, active kcal, distance and workouts", async () => {
  expect(await readActivity("2026-10-28")).toEqual({
    steps: 8412,
    activeKcal: 432,
    distanceKm: 6.27,
    workouts: 2,
  })
  const opts = mockStats.mock.calls[0]?.[2] as {
    unit?: string
    filter: { date: { startDate: Date; endDate: Date } }
  }
  expect(opts.filter.date.startDate).toEqual(new Date(2026, 9, 28))
  expect(opts.filter.date.endDate).toEqual(new Date(2026, 9, 29))
})

test("asks for km and kcal units", async () => {
  await readActivity("2026-10-28")
  const unit = (id: string) =>
    (mockStats.mock.calls.find((c) => c[0] === id)?.[2] as { unit?: string })
      ?.unit
  expect(unit("HKQuantityTypeIdentifierActiveEnergyBurned")).toBe("kcal")
  expect(unit("HKQuantityTypeIdentifierDistanceWalkingRunning")).toBe("km")
})

test("a Health error reads as no activity", async () => {
  mockStats.mockRejectedValueOnce(new Error("denied"))
  expect(await readActivity("2026-10-28")).toBeNull()
})

test("no Health on this device: unavailable and nothing read", async () => {
  mockAvailable = false
  expect(healthAvailable()).toBe(false)
  expect(await readActivity("2026-10-28")).toBeNull()
  expect(await connectHealth()).toBe(false)
  expect(mockStats).not.toHaveBeenCalled()
})

test("android is never available", async () => {
  Platform.OS = "android"
  expect(healthAvailable()).toBe(false)
  expect(await readActivity("2026-10-28")).toBeNull()
})

test("connect asks to read only, never to write", async () => {
  expect(await connectHealth()).toBe(true)
  expect(mockAuth).toHaveBeenCalledWith({
    toRead: [
      "HKQuantityTypeIdentifierStepCount",
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "HKQuantityTypeIdentifierDistanceWalkingRunning",
      "HKWorkoutTypeIdentifier",
    ],
  })
})

// Last: it swaps the module registry.
test("a build without the native module reads as no Health", () => {
  jest.resetModules()
  jest.doMock("@kingstinct/react-native-healthkit", () => {
    throw new Error("NitroModules could not be found")
  })
  const h = require("../health") as typeof import("../health")
  expect(h.healthAvailable()).toBe(false)
})
