// The boot screen covers the app until it is ready AND the app has laid out
// its first frame, plays its intro first, waits for the end of a loop when
// loading runs long, and under Reduce Motion holds the still mark on the
// brand ground, then fades, as soon as the app is there.
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import * as SplashScreen from "expo-splash-screen"
import { Text } from "react-native"
import { BootGate, BootScreen, SCREEN_WAIT } from "../boot/boot-screen"
import { resetScreenShown, screenShown } from "../boot/first-screen"
import { TIMING as timing } from "../boot/unfurl-mark"

jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}))
let mockReduced = false
// Animations finish at once; the boot screen's own timers set the pace.
jest.mock("react-native-reanimated", () => {
  const { extras } = require("./reanimated-extras")
  const id = (x: unknown) => x
  return {
    __esModule: true,
    ...extras,
    Easing: { ...extras.Easing, quad: id, sin: id, back: () => id },
    default: require("react-native").Animated,
    useSharedValue: (value: unknown) =>
      require("react").useRef({ value }).current,
    useAnimatedStyle: (get: () => unknown) => get(),
    withTiming: (value: unknown, _: unknown, done?: (ok: boolean) => void) => {
      done?.(true)
      return value
    },
    useReducedMotion: () => mockReduced,
  }
})

const overlay = () => screen.queryByLabelText("Opening Unfurl")

beforeEach(() => {
  jest.useFakeTimers()
  mockReduced = false
  resetScreenShown()
})
afterEach(() => jest.useRealTimers())

test("the native splash is held, then hidden once the boot screen draws", () => {
  expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalled()
  render(<BootScreen ready={false} />)
  fireEvent(screen.getByLabelText("Opening Unfurl"), "layout", {
    nativeEvent: { layout: {} },
  })
  expect(SplashScreen.hideAsync).toHaveBeenCalled()
})

test("ready during the intro: the intro still plays, then the screen goes", () => {
  render(<BootScreen ready />)
  act(() => jest.advanceTimersByTime(timing.intro - 10))
  expect(overlay()).toBeTruthy()
  act(() => jest.advanceTimersByTime(10 + timing.exit + 100))
  expect(overlay()).toBeNull()
})

test("still loading: it loops, and leaves at the end of a cycle", () => {
  const { rerender } = render(<BootScreen ready={false} />)
  act(() => jest.advanceTimersByTime(timing.intro + timing.loop * 3))
  expect(overlay()).toBeTruthy()
  // Ready a third of the way into a cycle: the rest of the cycle plays.
  act(() => jest.advanceTimersByTime(timing.loop / 3))
  rerender(<BootScreen ready />)
  act(() => jest.advanceTimersByTime((timing.loop * 2) / 3 - 20))
  expect(overlay()).toBeTruthy()
  act(() => jest.advanceTimersByTime(20 + timing.exit + 100))
  expect(overlay()).toBeNull()
})

test("Reduce Motion: no intro, the still mark fades once the app is ready", () => {
  mockReduced = true
  const { rerender } = render(<BootScreen ready={false} />)
  act(() => jest.advanceTimersByTime(5000))
  expect(overlay()).toBeTruthy()
  rerender(<BootScreen ready />)
  act(() => jest.advanceTimersByTime(timing.exit + 50))
  expect(overlay()).toBeNull()
})

const app = (props: { ready: boolean; failed?: boolean }) => (
  <BootGate {...props}>
    <Text>Today</Text>
  </BootGate>
)
const layOut = () =>
  fireEvent(screen.getByTestId("app-root"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
  })

test.each([
  ["full motion", false],
  ["Reduce Motion", true],
])("%s: ready is not enough, the boot screen stays until the first screen has drawn", (_, reduced) => {
  // Build 24 went white here: the boot screen left on "ready" while the
  // app's first frame (rendered in a transition) had not landed yet.
  mockReduced = reduced
  render(app({ ready: true }))
  act(() => jest.advanceTimersByTime(timing.intro + timing.loop * 4))
  expect(screen.getByText("Today")).toBeTruthy()
  expect(overlay()).toBeTruthy()
  // The app's container lays out a beat before its first screen draws.
  layOut()
  act(() => jest.advanceTimersByTime(SCREEN_WAIT / 2))
  expect(overlay()).toBeTruthy()
  act(() => screenShown())
  act(() => jest.advanceTimersByTime(timing.loop + timing.exit + 100))
  expect(overlay()).toBeNull()
})

test("a first screen that never reports cannot keep the boot screen up", () => {
  mockReduced = true
  render(app({ ready: true }))
  layOut()
  act(() => jest.advanceTimersByTime(SCREEN_WAIT + timing.exit + 50))
  expect(overlay()).toBeNull()
})

test("storage failed: the boot screen leaves so the error can be read", () => {
  mockReduced = true
  render(app({ ready: false, failed: true }))
  act(() => jest.advanceTimersByTime(timing.exit + 50))
  expect(overlay()).toBeNull()
  expect(screen.queryByText("Today")).toBeNull()
})
