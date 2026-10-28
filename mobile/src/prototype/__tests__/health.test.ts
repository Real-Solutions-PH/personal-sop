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
// Daily buckets for a range: Oct 26 and Oct 28 have samples, Oct 27 none.
const mockCollection = jest.fn(
  async (id: string, _s: unknown, _anchor: Date, _i: unknown, _o: unknown) =>
    [26, 28].map((d) => ({
      startDate: new Date(2026, 9, d),
      sumQuantity: {
        unit: "x",
        quantity: (sums[id] ?? 0) / (d === 26 ? 2 : 1),
      },
    })),
)
const mockWorkouts = jest.fn(async (_o: unknown) => [{}, {}])
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m)
// The night into Oct 28: Watch and iPhone overlap; in-bed and awake don't count.
const mockSleep = jest.fn(async (_id: string, _o: unknown) => [
  { startDate: at(27, 23), endDate: at(28, 7), value: 3 },
  { startDate: at(28, 1), endDate: at(28, 7, 30), value: 1 },
  { startDate: at(27, 22), endDate: at(28, 8), value: 0 },
  { startDate: at(28, 3), endDate: at(28, 3, 20), value: 2 },
])
const mockAuth = jest.fn(async (_t: unknown) => true)
let mockStatus = 1 // HealthKit: 1 = never asked, 2 = already answered
let mockAvailable = true
jest.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: () => mockAvailable,
  requestAuthorization: (t: unknown) => mockAuth(t),
  getRequestStatusForAuthorization: async () => mockStatus,
  queryStatisticsForQuantity: (id: string, s: unknown, o: unknown) =>
    mockStats(id, s, o),
  queryWorkoutSamples: (o: unknown) => mockWorkouts(o),
  queryCategorySamples: (id: string, o: unknown) => mockSleep(id, o),
  queryStatisticsCollectionForQuantity: (
    id: string,
    s: unknown,
    a: Date,
    i: unknown,
    o: unknown,
  ) => mockCollection(id, s, a, i, o),
}))

let mockEnv = "bare"
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get executionEnvironment() {
      return mockEnv
    },
  },
}))

import {
  asleepMinutes,
  connectHealth,
  healthAsked,
  healthAvailable,
  localDay,
  readActivity,
  readDays,
  readSleep,
} from "../health"

beforeEach(() => {
  mockEnv = "bare"
  mockStatus = 1
  mockAvailable = true
  mockCollection.mockClear()
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
      "HKCategoryTypeIdentifierSleepAnalysis",
    ],
  })
})

test("asleep minutes: overlapping sources count once, in-bed and awake never", () => {
  const night = [
    { startDate: at(27, 23), endDate: at(28, 7), value: 3 },
    { startDate: at(28, 1), endDate: at(28, 7, 30), value: 1 },
    { startDate: at(27, 22), endDate: at(28, 8), value: 0 },
    { startDate: at(28, 3), endDate: at(28, 3, 20), value: 2 },
  ]
  expect(asleepMinutes(night, at(27, 18), at(28, 18))).toBe(510)
})

test("asleep minutes: a sample across 18:00 is split between the two nights", () => {
  const nap = [{ startDate: at(27, 17), endDate: at(27, 19), value: 1 }]
  expect(asleepMinutes(nap, at(27, 18), at(28, 18))).toBe(60)
  expect(asleepMinutes(nap, at(26, 18), at(27, 18))).toBe(60)
})

test("sleep for a run of nights: one query, each night on the day you wake", async () => {
  expect(await readSleep(["2026-10-27", "2026-10-28"])).toEqual([0, 510])
  expect(mockSleep).toHaveBeenCalledTimes(1)
  const [id, opts] = mockSleep.mock.calls[0] ?? []
  expect(id).toBe("HKCategoryTypeIdentifierSleepAnalysis")
  expect(opts).toMatchObject({
    limit: 0,
    filter: { date: { startDate: at(26, 18), endDate: at(28, 18) } },
  })
})

test("sleep: nothing for every night when Health can't answer", async () => {
  mockSleep.mockRejectedValueOnce(new Error("denied"))
  expect(await readSleep(["2026-10-27", "2026-10-28"])).toEqual([null, null])
  mockAvailable = false
  expect(await readSleep(["2026-10-28"])).toEqual([null])
})

test("sleep in Expo Go: sample nights, no Health calls", async () => {
  mockEnv = "storeClient"
  const nights = await readSleep(["2026-10-26", "2026-10-27"])
  expect(nights.every((m) => (m ?? 0) > 0)).toBe(true)
  expect(mockSleep).not.toHaveBeenCalled()
})

test("Expo Go has no HealthKit, so it shows sample activity that grows over the day", async () => {
  mockEnv = "storeClient"
  mockAvailable = false
  expect(healthAvailable()).toBe(true)
  expect(await connectHealth()).toBe(true)
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 28, 9, 0))
  const morning = await readActivity("2026-10-28")
  jest.setSystemTime(new Date(2026, 9, 28, 18, 0))
  const evening = await readActivity("2026-10-28")
  jest.useRealTimers()
  expect(morning?.activeKcal).toBeGreaterThan(0)
  expect(
    (evening?.activeKcal ?? 0) - (morning?.activeKcal ?? 0),
  ).toBeGreaterThan(50)
  // A past day is a full day.
  expect((await readActivity("2026-10-27"))?.activeKcal).toBeGreaterThan(
    evening?.activeKcal ?? 0,
  )
  const week = await Promise.all(
    ["2026-10-24", "2026-10-25", "2026-10-26"].map(readActivity),
  )
  expect(new Set(week.map((a) => a?.steps)).size).toBe(3)
  expect(mockStats).not.toHaveBeenCalled()
})

test("a real build never shows sample activity", async () => {
  mockEnv = "standalone"
  mockAvailable = false
  expect(healthAvailable()).toBe(false)
  expect(await readActivity("2026-10-28")).toBeNull()
})

test("asked: false until the Health sheet has been answered", async () => {
  expect(await healthAsked()).toBe(false)
  mockStatus = 2
  expect(await healthAsked()).toBe(true)
})

test("asked: false where there is no Health, true in Expo Go's sample", async () => {
  mockAvailable = false
  expect(await healthAsked()).toBe(false)
  mockEnv = "storeClient"
  expect(await healthAsked()).toBe(true)
})

test("a run of days: one daily-total query per metric, days with nothing are 0", async () => {
  const days = await readDays(["2026-10-26", "2026-10-27", "2026-10-28"])
  expect(days).toEqual([
    { steps: 4206, activeKcal: 216, distanceKm: 3.14 },
    { steps: 0, activeKcal: 0, distanceKm: 0 },
    { steps: 8412, activeKcal: 432, distanceKm: 6.27 },
  ])
  expect(mockCollection).toHaveBeenCalledTimes(3)
  expect(mockStats).not.toHaveBeenCalled()
  expect(mockWorkouts).not.toHaveBeenCalled()
  const [, stats, anchor, interval, opts] = mockCollection.mock.calls[0] ?? []
  expect(stats).toEqual(["cumulativeSum"])
  expect(anchor).toEqual(new Date(2026, 9, 26))
  expect(interval).toEqual({ day: 1 })
  expect(opts).toMatchObject({
    filter: {
      date: {
        startDate: new Date(2026, 9, 26),
        endDate: new Date(2026, 9, 29),
      },
    },
  })
})

test("a run of days: a Health error reads as nothing for every day", async () => {
  mockCollection.mockRejectedValueOnce(new Error("denied"))
  expect(await readDays(["2026-10-27", "2026-10-28"])).toEqual([null, null])
})

test("a run of days in Expo Go: the sample, no Health calls", async () => {
  mockEnv = "storeClient"
  const days = await readDays(["2026-10-26", "2026-10-27"])
  expect(days.every((d) => (d?.steps ?? 0) > 0)).toBe(true)
  expect(mockCollection).not.toHaveBeenCalled()
})

test("localDay is the calendar date, midnight to midnight", () => {
  expect(localDay(new Date(2026, 9, 28, 1, 30))).toBe("2026-10-28")
  expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05")
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
