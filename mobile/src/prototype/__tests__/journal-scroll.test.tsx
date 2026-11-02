// A long journal entry scrolls from its first line to its last. The entry
// was a fixed-height box that scrolled on its own inside the scrolling page:
// with the keyboard up the page scrolled the box's first line under the date
// row, and a drag on the text only moved the inner box, so the page could
// not be pulled back. The entry now grows with its text and the page is the
// one scroller; typing at the end keeps the caret's line in view.
import { captureStore } from "@domain/capture/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { ScrollView, StyleSheet } from "react-native"
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { Journal } =
  require("../screens/journal") as typeof import("../screens/journal")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const BODY = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n")
const layout = (height: number, y = 0) => ({
  persist: () => {},
  nativeEvent: { layout: { x: 0, y, width: 390, height } },
})
const scrollTo = ScrollView.prototype.scrollTo as jest.Mock

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  captureStore.set((s) => ({
    ...s,
    journal: [
      {
        id: "j1",
        day: "2026-11-01",
        createdAt: "2026-11-01T13:00:00.000Z",
        body: BODY,
        source: "text",
        tags: [],
        private: true,
      },
    ],
  }))
  scrollTo.mockClear()
})

it("the entry grows with its text instead of scrolling inside the page", () => {
  render(<Journal id="j1" />, { wrapper })
  const entry = screen.getByLabelText("Entry")
  expect(entry.props.scrollEnabled).toBe(false)
  const style = StyleSheet.flatten(entry.props.style)
  expect(style.height).toBeUndefined()
  expect(style.minHeight).toBeGreaterThan(0)
})

/** The page is 400pt tall above the keyboard; the entry starts 20pt down. */
function typingAt(selection: number) {
  render(<Journal id="j1" />, { wrapper })
  const page = screen.UNSAFE_getByType(ScrollView)
  fireEvent(page, "layout", layout(400))
  fireEvent.scroll(page, {
    nativeEvent: {
      contentOffset: { x: 0, y: 0 },
      contentSize: { width: 390, height: 2000 },
      layoutMeasurement: { width: 390, height: 400 },
    },
  })
  const entry = screen.getByLabelText("Entry")
  fireEvent(entry, "layout", layout(1200, 20))
  fireEvent(entry, "focus")
  fireEvent(entry, "selectionChange", {
    nativeEvent: { selection: { start: selection, end: selection } },
  })
  fireEvent(entry, "contentSizeChange", {
    nativeEvent: { contentSize: { width: 390, height: 1200 } },
  })
  return page
}

it("typing at the end scrolls the page so the caret's line shows", () => {
  typingAt(BODY.length)
  expect(scrollTo).toHaveBeenCalled()
  const { y } = scrollTo.mock.lastCall?.[0] ?? { y: -1 }
  // The entry's last line ends at 20 + 1200; the 400pt page shows it.
  expect(y + 400).toBeGreaterThanOrEqual(20 + 1200)
  expect(y + 400).toBeLessThanOrEqual(20 + 1200 + 48)
})

it("editing the middle of a long entry does not jump the page", () => {
  typingAt(10)
  expect(scrollTo).not.toHaveBeenCalled()
})
