// Fitness settings' Apple Health row: Connect before the Health sheet was
// answered, a way into the Health app's sharing settings after.
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import { Linking } from "react-native"
import { HealthSettings } from "../screens/health-connect"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
let mockAvailable = true
let mockAsked = false
const mockConnect = jest.fn(async () => {
  mockAsked = true
  return true
})
let mockCanOffer = true
let mockCanWrite = false
const mockConnectWrite = jest.fn(async () => {
  mockAsked = true
  return mockCanWrite
})
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  healthAsked: async () => mockAsked,
  connectHealth: () => mockConnect(),
  canOfferWorkoutWrite: () => mockAvailable && mockCanOffer,
  canWriteWorkouts: () => mockCanWrite,
  connectWorkoutWrite: () => mockConnectWrite(),
}))
jest.mock("../health-workouts", () => {
  const { createStore } = require("@domain/lib/store")
  return {
    healthWorkoutsStore: createStore(
      "healthWorkouts-test",
      () => ({ enabled: false, enabledAt: null as string | null }),
      { persist: false },
    ),
  }
})

import { toast } from "sonner-native"
import { healthWorkoutsStore } from "../health-workouts"

beforeEach(() => {
  mockAvailable = true
  mockAsked = false
  mockCanOffer = true
  mockCanWrite = false
  mockConnect.mockClear()
  mockConnectWrite.mockClear()
  jest.clearAllMocks()
  healthWorkoutsStore.set((s) => ({ ...s, enabled: false, enabledAt: null }))
})

const SWITCH = "Save workouts to Apple Health"

test("the save-workouts switch is off by default and asks Health when turned on", async () => {
  mockCanWrite = true
  render(<HealthSettings />)
  const sw = await screen.findByRole("switch", { name: SWITCH })
  expect(sw.props.accessibilityState?.checked).toBe(false)
  fireEvent.press(sw)
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      "Workouts will be saved to Apple Health",
    ),
  )
  expect(mockConnectWrite).toHaveBeenCalledTimes(1)
  expect(healthWorkoutsStore.get().enabled).toBe(true)
  expect(healthWorkoutsStore.get().enabledAt).toEqual(expect.any(String))
  // Off again: stops saving, keeps what Health has.
  fireEvent.press(screen.getByRole("switch", { name: SWITCH }))
  expect(healthWorkoutsStore.get().enabled).toBe(false)
  expect(toast.success).toHaveBeenCalledWith(
    "Workouts won't be saved to Apple Health",
  )
})

test("denied: the switch stays off and points to the Health app", async () => {
  render(<HealthSettings />)
  fireEvent.press(await screen.findByRole("switch", { name: SWITCH }))
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Allow Unfurl to write Workouts in the Health app: Sharing → Apps → Unfurl",
    ),
  )
  expect(healthWorkoutsStore.get().enabled).toBe(false)
  expect(await screen.findByText("Manage in the Health app")).toBeTruthy()
})

test("on but revoked in Health: says so", async () => {
  mockAsked = true
  healthWorkoutsStore.set((s) => ({
    ...s,
    enabled: true,
    enabledAt: "2026-10-30T00:00:00Z",
  }))
  render(<HealthSettings />)
  expect(await screen.findByText(/^Not allowed in the Health app/)).toBeTruthy()
})

test("Expo Go or no Health: no switch", async () => {
  mockCanOffer = false
  render(<HealthSettings />)
  expect(await screen.findByText("Connect Apple Health")).toBeTruthy()
  expect(screen.queryByRole("switch", { name: SWITCH })).toBeNull()
})

test("not asked yet: Connect opens the Health sheet", async () => {
  render(<HealthSettings />)
  fireEvent.press(await screen.findByText("Connect Apple Health"))
  expect(mockConnect).toHaveBeenCalled()
  expect(await screen.findByText("Manage in the Health app")).toBeTruthy()
})

test("already asked: Manage opens the Health app", async () => {
  mockAsked = true
  const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined)
  render(<HealthSettings />)
  fireEvent.press(await screen.findByText("Manage in the Health app"))
  expect(open).toHaveBeenCalledWith("x-apple-health://")
})

test("Health app link failing falls back to this app's Settings", async () => {
  mockAsked = true
  jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"))
  const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue()
  render(<HealthSettings />)
  fireEvent.press(await screen.findByText("Manage in the Health app"))
  await new Promise((r) => setTimeout(r, 0))
  expect(settings).toHaveBeenCalled()
})

test("no Health on the device: no section", () => {
  mockAvailable = false
  render(<HealthSettings />)
  expect(screen.toJSON()).toBeNull()
})
