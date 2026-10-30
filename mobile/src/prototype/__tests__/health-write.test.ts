// Writing workouts to Apple Health: asked for only from the switch, one
// duration-only workout per save, and a Health error reads as "not saved".
import { Platform } from "react-native"

const mockAuth = jest.fn(async (_t: unknown) => true)
let mockWriteStatus = 2 // HKAuthorizationStatus: 1 denied, 2 allowed
const mockStatusFor = jest.fn((_id: string) => mockWriteStatus)
const mockSave = jest.fn(async (..._a: unknown[]) => ({ uuid: "hk-1" }))
const mockDelete = jest.fn(async (_id: string, _f: unknown) => 1)
let mockAvailable = true
jest.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: () => mockAvailable,
  requestAuthorization: (t: unknown) => mockAuth(t),
  authorizationStatusFor: (id: string) => mockStatusFor(id),
  saveWorkoutSample: (...a: unknown[]) => mockSave(...a),
  deleteObjects: (id: string, f: unknown) => mockDelete(id, f),
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
  canOfferWorkoutWrite,
  canWriteWorkouts,
  connectHealth,
  connectWorkoutWrite,
  deleteSavedWorkout,
  saveWorkout,
} from "../health"

beforeEach(() => {
  jest.clearAllMocks()
  mockEnv = "bare"
  mockWriteStatus = 2
  mockAvailable = true
  Platform.OS = "ios"
})

const READ = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKWorkoutTypeIdentifier",
  "HKCategoryTypeIdentifierSleepAnalysis",
]
const input = {
  id: "w-1",
  name: "Push Day",
  start: new Date(2026, 9, 30, 7, 0),
  end: new Date(2026, 9, 30, 7, 52),
  cardio: false,
}

test("the switch asks to write workouts, and allowed means status 2", async () => {
  expect(await connectWorkoutWrite()).toBe(true)
  expect(mockAuth).toHaveBeenCalledWith({
    toShare: ["HKWorkoutTypeIdentifier"],
    toRead: READ,
  })
  expect(mockStatusFor).toHaveBeenCalledWith("HKWorkoutTypeIdentifier")
  mockWriteStatus = 1
  expect(await connectWorkoutWrite()).toBe(false)
  expect(canWriteWorkouts()).toBe(false)
})

test("the Connect card still asks to read only", async () => {
  await connectHealth()
  expect(mockAuth).toHaveBeenCalledWith({ toRead: READ })
})

test("a save is one strength workout with its exact times and Unfurl metadata", async () => {
  expect(await saveWorkout(input)).toBe("hk-1")
  expect(mockSave).toHaveBeenCalledWith(
    50,
    [],
    input.start,
    input.end,
    undefined,
    {
      HKMetadataKeySyncIdentifier: "unfurl-workout-w-1",
      HKMetadataKeySyncVersion: 1,
      HKMetadataKeyWorkoutBrandName: "Unfurl",
      HKMetadataKeyExternalUUID: "w-1",
      UnfurlWorkoutName: "Push Day",
    },
  )
})

test("a cardio-only workout is saved as mixed cardio", async () => {
  await saveWorkout({ ...input, cardio: true })
  expect(mockSave.mock.calls[0][0]).toBe(73)
})

test("a Health error on save is null, not a throw", async () => {
  mockSave.mockRejectedValueOnce(new Error("protected data"))
  expect(await saveWorkout(input)).toBeNull()
})

test("deleting removes the sample by its uuid", async () => {
  expect(await deleteSavedWorkout("hk-1")).toBe(true)
  expect(mockDelete).toHaveBeenCalledWith("HKWorkoutTypeIdentifier", {
    uuid: "hk-1",
  })
  mockDelete.mockRejectedValueOnce(new Error("no"))
  expect(await deleteSavedWorkout("hk-1")).toBe(false)
})

test("Expo Go and devices without Health never offer or write", async () => {
  mockEnv = "storeClient"
  expect(canOfferWorkoutWrite()).toBe(false)
  expect(await connectWorkoutWrite()).toBe(false)
  expect(await saveWorkout(input)).toBeNull()
  mockEnv = "bare"
  mockAvailable = false
  expect(canOfferWorkoutWrite()).toBe(false)
  expect(canWriteWorkouts()).toBe(false)
  expect(mockSave).not.toHaveBeenCalled()
  expect(mockAuth).not.toHaveBeenCalled()
})
