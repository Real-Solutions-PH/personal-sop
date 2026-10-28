// Fitness settings' Apple Health row: Connect before the Health sheet was
// answered, a way into the Health app's sharing settings after.
import { fireEvent, render, screen } from "@testing-library/react-native"
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
jest.mock("../health", () => ({
  healthAvailable: () => mockAvailable,
  healthAsked: async () => mockAsked,
  connectHealth: () => mockConnect(),
}))

beforeEach(() => {
  mockAvailable = true
  mockAsked = false
  mockConnect.mockClear()
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
