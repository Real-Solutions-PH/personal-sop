// The journal editor saves itself: a pause in typing writes the entry (a new
// one is created once), leaving writes what is still waiting, and a new
// entry left empty is never kept. There is no Save button.
import { captureStore } from "@domain/capture/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { Journal, AUTOSAVE_MS } =
  require("../screens/journal") as typeof import("../screens/journal")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const entries = () => captureStore.get().journal

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  captureStore.set((s) => ({ ...s, journal: [] }))
})
afterEach(() => jest.useRealTimers())

it("creates the entry once after a pause, then updates it in place", () => {
  render(<Journal creating />, { wrapper })
  expect(screen.queryByText(/Save entry|Save changes/)).toBeNull()
  fireEvent.changeText(screen.getByLabelText("Entry"), "Slept well")
  expect(screen.getByText("Saving…")).toBeTruthy()
  expect(entries()).toHaveLength(0)
  act(() => jest.advanceTimersByTime(AUTOSAVE_MS))
  expect(entries().map((e) => e.body)).toEqual(["Slept well"])
  fireEvent.changeText(screen.getByLabelText("Entry"), "Slept well, ran 5k")
  act(() => jest.advanceTimersByTime(AUTOSAVE_MS))
  expect(entries().map((e) => e.body)).toEqual(["Slept well, ran 5k"])
  expect(screen.getByText(/^Saved/)).toBeTruthy()
})

it("leaving before the pause still saves what was typed", () => {
  const { unmount } = render(<Journal creating />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Entry"), "Quick note")
  unmount()
  expect(entries().map((e) => e.body)).toEqual(["Quick note"])
})

it("a new entry emptied before leaving is not kept", () => {
  const { unmount } = render(<Journal creating />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Entry"), "Oops")
  act(() => jest.advanceTimersByTime(AUTOSAVE_MS))
  fireEvent.changeText(screen.getByLabelText("Entry"), "")
  act(() => jest.advanceTimersByTime(AUTOSAVE_MS))
  expect(screen.getByText("Not saved while empty")).toBeTruthy()
  unmount()
  expect(entries()).toHaveLength(0)
})

it("an opened entry is edited in place", () => {
  captureStore.set((s) => ({
    ...s,
    journal: [
      {
        id: "j1",
        day: "2026-10-30",
        createdAt: "2026-10-30T13:00:00.000Z",
        body: "Old words",
        source: "text",
        tags: [],
        private: true,
      },
    ],
  }))
  const { unmount } = render(<Journal id="j1" />, { wrapper })
  fireEvent.changeText(screen.getByLabelText("Entry"), "New words")
  act(() => jest.advanceTimersByTime(AUTOSAVE_MS))
  expect(entries().map((e) => [e.id, e.body])).toEqual([["j1", "New words"]])
  unmount()
  expect(entries()).toHaveLength(1)
})
