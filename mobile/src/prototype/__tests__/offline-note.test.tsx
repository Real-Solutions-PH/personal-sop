// Offline, said by Fern: a bubble that points at the Fern button above the
// tab bar, or carries a small Fern where there is no bar; it says the
// changes are safe, and screen readers hear it as one alert.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

const { OFFLINE_LABEL, OfflineNote } =
  require("../offline-note") as typeof import("../offline-note")

beforeEach(() => {
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
