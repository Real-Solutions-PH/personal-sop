// Every feature can be hidden from Settings → Sections, one at a time or all
// at once, and a hidden feature's entry points leave the app.

import { MODULE_KEYS } from "@domain/dash/data"
import { dashStore } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { privacyStore } from "@domain/lib/privacy"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Alert } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { AppLauncher } from "../app-launcher"
import { EXTRAS, extrasStore, setShown } from "../extras"
import { Settings } from "../screens/dash-profile"
import { Me } from "../screens/me"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
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
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const allOff = () =>
  MODULE_KEYS.every((k) => !dashStore.get().enabled[k]) &&
  EXTRAS.every((x) => !extrasStore.get()[x.key])
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.restoreAllMocks()
})

test("every feature starts shown", () => {
  expect(EXTRAS.every((x) => extrasStore.get()[x.key])).toBe(true)
  render(<Settings />, { wrapper })
  expect(
    screen.getByRole("switch", { name: "All features" }).props
      .accessibilityState,
  ).toMatchObject({ checked: true })
})

test("Journal switches off on its own and leaves the launcher and Me", () => {
  const settings = render(<Settings />, { wrapper })
  fireEvent.press(screen.getByRole("switch", { name: "Journal" }))
  expect(extrasStore.get().journal).toBe(false)
  expect(extrasStore.get().social).toBe(true)
  expect(
    screen.getByRole("switch", { name: "All features" }).props
      .accessibilityState,
  ).toMatchObject({ checked: false })
  settings.unmount()
  render(<AppLauncher />, { wrapper })
  expect(screen.queryByLabelText("Journal")).toBeNull()
  expect(screen.getByLabelText("Habits")).toBeTruthy()
})

test("Me hides the Journal and Social profile rows when they are off", () => {
  setShown("journal", false)
  setShown("social", false)
  render(<Me />, { wrapper })
  expect(screen.queryByText("Wrap-up & review reflections")).toBeNull()
  expect(screen.queryByText("Social profile")).toBeNull()
  expect(screen.getByText("Goals")).toBeTruthy()
})

test("All features turns everything off after confirming, and back on", () => {
  const alert = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) =>
      buttons?.find((b) => b.style === "destructive")?.onPress?.(),
    )
  render(<Settings />, { wrapper })
  fireEvent.press(screen.getByRole("switch", { name: "All features" }))
  expect(alert).toHaveBeenCalledTimes(1)
  expect(allOff()).toBe(true)
  fireEvent.press(screen.getByRole("switch", { name: "All features" }))
  // Screen time turns on only once iOS allows it (a phone without Screen
  // Time here); everything else is back on at once.
  expect(MODULE_KEYS.filter((k) => !dashStore.get().enabled[k])).toEqual([
    "screen",
  ])
  expect(EXTRAS.every((x) => extrasStore.get()[x.key])).toBe(true)
})

test("cancelling the all-off prompt keeps every feature on", () => {
  jest.spyOn(Alert, "alert").mockImplementation(() => {})
  render(<Settings />, { wrapper })
  fireEvent.press(screen.getByRole("switch", { name: "All features" }))
  expect(MODULE_KEYS.every((k) => dashStore.get().enabled[k])).toBe(true)
  expect(EXTRAS.every((x) => extrasStore.get()[x.key])).toBe(true)
})

test("Today drops Community and Weather when they are off", () => {
  jest.useFakeTimers({ now: new Date(`${dayKey()}T09:30:00`) })
  const { Today } = require("../screens/today")
  const on = render(<Today />, { wrapper })
  expect(screen.getAllByLabelText(/^Community/).length).toBeGreaterThan(0)
  on.unmount()
  setShown("social", false)
  setShown("weather", false)
  const off = render(<Today />, { wrapper })
  expect(screen.queryByLabelText(/^Community/)).toBeNull()
  off.unmount()
  jest.useRealTimers()
})

test("Help improve Fern starts off, turns on only after the prompt, and off at once", () => {
  expect(privacyStore.get().fernEval).toBe(false)
  const declined = jest.spyOn(Alert, "alert").mockImplementation(() => {})
  render(<Me />, { wrapper })
  const toggle = () => screen.getByRole("switch", { name: "Help improve Fern" })
  fireEvent.press(toggle())
  expect(declined).toHaveBeenCalledTimes(1)
  expect(declined.mock.calls[0][1]).toMatch(
    /anonymised copies of your chats.*never published/,
  )
  expect(privacyStore.get().fernEval).toBe(false)
  declined.mockRestore()
  const accepted = jest
    .spyOn(Alert, "alert")
    .mockImplementation((_t, _m, buttons) =>
      buttons?.find((b) => b.text === "Turn on")?.onPress?.(),
    )
  fireEvent.press(toggle())
  expect(privacyStore.get().fernEval).toBe(true)
  expect(toggle().props.accessibilityState).toMatchObject({ checked: true })
  fireEvent.press(toggle())
  expect(accepted).toHaveBeenCalledTimes(1)
  expect(privacyStore.get().fernEval).toBe(false)
})

test("the daily check-in is switched on in Settings at the evening time, then its time shows", () => {
  render(<Settings />, { wrapper })
  expect(screen.queryByLabelText("Check-in time")).toBeNull()
  fireEvent.press(screen.getByLabelText("Daily check-in"))
  expect(dashStore.get().push.checkin).toBe(dashStore.get().push.evening)
  expect(screen.getAllByLabelText(/Check-in time/).length).toBeGreaterThan(0)
  fireEvent.press(screen.getByLabelText("Daily check-in"))
  expect(dashStore.get().push.checkin).toBe("")
})
