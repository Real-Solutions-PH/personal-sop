// The boot screen covers the app until it is ready, plays its intro first,
// waits for the end of a loop when loading runs long, and under Reduce
// Motion leaves as soon as the app is ready without animating.
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import * as SplashScreen from "expo-splash-screen"
import { BootScreen } from "../boot/boot-screen"
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

test("Reduce Motion: no intro, gone the moment the app is ready", () => {
  mockReduced = true
  const { rerender } = render(<BootScreen ready={false} />)
  act(() => jest.advanceTimersByTime(5000))
  expect(overlay()).toBeTruthy()
  rerender(<BootScreen ready />)
  expect(overlay()).toBeNull()
})
