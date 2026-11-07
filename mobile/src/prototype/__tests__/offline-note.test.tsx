// Offline, said by Fern: a bubble that points at the Fern button above the
// tab bar, or carries a small Fern where there is no bar; it says the
// changes are safe, and screen readers hear it as one alert.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"

// Reduce Motion per test; ``mockFade`` holds the last fade's finish callback,
// fired by hand to stand in for the UI thread ending the animation.
const mockMotion = { reduced: true }
let mockFade: ((done: boolean) => void) | undefined
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown, _: unknown, done?: (d: boolean) => void) => {
    mockFade = done
    return value
  },
  runOnJS:
    (f: (...a: unknown[]) => void) =>
    (...a: unknown[]) =>
      f(...a),
  useReducedMotion: () => mockMotion.reduced,
}))

const { OFFLINE_LABEL, OfflineNote } =
  require("../offline-note") as typeof import("../offline-note")

beforeEach(() => {
  mockMotion.reduced = true
  mockFade = undefined
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("with the tab bar: reassures, as one alert, without its own Fern", () => {
  render(<OfflineNote offline withBar />)
  const note = screen.getByTestId("offline-note")
  expect(note.props.accessibilityRole).toBe("alert")
  expect(note.props.accessibilityLabel).toBe(OFFLINE_LABEL)
  expect(screen.getByText(/your changes are safe on this phone/)).toBeTruthy()
  expect(screen.queryByLabelText(/Fern/)).toBeNull()
  expect(screen.UNSAFE_queryAllByProps({ decorative: true })).toHaveLength(0)
})

test("without the bar: a small Fern speaks, above the home indicator", () => {
  render(<OfflineNote offline withBar={false} bottomInset={34} />)
  expect(screen.UNSAFE_queryAllByProps({ decorative: true })).toHaveLength(1)
  const note = screen.getByTestId("offline-note")
  const flat = [note.props.style].flat().reduce((a, b) => ({ ...a, ...b }), {})
  expect(flat.paddingBottom).toBe(34)
})

test("online: nothing, and coming back online gives the room back", () => {
  const { rerender } = render(<OfflineNote offline={false} withBar />)
  expect(screen.queryByTestId("offline-note")).toBeNull()
  rerender(<OfflineNote offline withBar />)
  expect(screen.getByTestId("offline-note")).toBeTruthy()
  act(() => rerender(<OfflineNote offline={false} withBar />))
  // Reduce Motion (as mocked): gone at once, no fade to wait for.
  expect(screen.queryByTestId("offline-note")).toBeNull()
})

test("with motion: the room is given back only once the fade-out ends", () => {
  mockMotion.reduced = false
  const { rerender } = render(<OfflineNote offline withBar />)
  rerender(<OfflineNote offline={false} withBar />)
  expect(screen.getByTestId("offline-note")).toBeTruthy()
  act(() => mockFade?.(true))
  expect(screen.queryByTestId("offline-note")).toBeNull()
})

test("offline again as the fade-out ends: the note stays", () => {
  mockMotion.reduced = false
  const { rerender } = render(<OfflineNote offline withBar />)
  rerender(<OfflineNote offline={false} withBar />)
  const fadeOut = mockFade
  // Back offline before the UI thread reports the old fade finished.
  rerender(<OfflineNote offline withBar />)
  act(() => fadeOut?.(true))
  expect(screen.getByTestId("offline-note")).toBeTruthy()
})
