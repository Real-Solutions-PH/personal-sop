// The tracker never asks for location on a treadmill, polls Health for the
// motion distance instead, and fills a finished treadmill session's
// distance from the full window unless the person already entered one.
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"

const mockLocation = {
  requestForegroundPermissionsAsync: jest.fn(async () => ({
    status: "granted",
  })),
  watchPositionAsync: jest.fn(async () => ({ remove: jest.fn() })),
  hasStartedLocationUpdatesAsync: jest.fn(async () => false),
  stopLocationUpdatesAsync: jest.fn(async () => {}),
  startLocationUpdatesAsync: jest.fn(async () => {}),
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { Fitness: 3 },
}
jest.mock("expo-location", () => mockLocation)
jest.mock("expo-task-manager", () => {
  throw new Error("not in this build")
})
let mockReading = { steps: 3100, hr: null, distanceM: 2400 }
jest.mock("../health", () => ({
  connectHealth: jest.fn(async () => true),
  healthAvailable: () => true,
  readWindow: jest.fn(async () => mockReading),
}))

const { startRunTracker, startTracking } =
  require("../run-tracker") as typeof import("../run-tracker")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  fitStore.set((s) => ({ ...s, weighIns: [], runs: [] }))
  jest.clearAllMocks()
  mockReading = { steps: 3100, hr: null, distanceM: 2400 }
})

const flush = () => new Promise((r) => setTimeout(r, 0))

it("a treadmill session never starts location; Health gives its distance", async () => {
  startRunTracker()
  RL.startRun("walk", Date.now() - 1_200_000, { indoor: true })
  await flush()
  expect(mockLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled()
  expect(mockLocation.watchPositionAsync).not.toHaveBeenCalled()
  expect(RL.runLiveStore.get().active?.distanceM).toBe(2400)
  expect(RL.runLiveStore.get().active?.steps).toBe(3100)
  // The finish read covers the whole window: Health has caught up.
  mockReading = { steps: 3300, hr: null, distanceM: 2550 }
  const done = RL.finishRun()!
  await flush()
  const saved = R.runsOf(fitStore.get()).find((r) => r.id === done.id)!
  expect(saved).toMatchObject({ distanceM: 2550, steps: 3300 })
})

it("an entered treadmill distance is never overwritten by the late read", async () => {
  startRunTracker()
  RL.startRun("walk", Date.now() - 1_200_000, { indoor: true })
  await flush()
  const done = RL.finishRun()!
  RL.setTreadmillReadings(done.id, { distanceM: 3000, inclinePct: null })
  await flush()
  expect(R.runsOf(fitStore.get())[0].distanceM).toBe(3000)
})

it("outdoors still asks for location", async () => {
  expect((await startTracking("walk")).ok).toBe(true)
  expect(mockLocation.requestForegroundPermissionsAsync).toHaveBeenCalled()
})
