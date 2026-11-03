// A long list renders a page of rows, and the next page as the screen
// scrolls near its end; a new search or filter starts from the first page.

import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { groupBy, MoreRows, Screen, usePaged } from "../ui"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  usePathname: () => "/",
  useLocalSearchParams: () => ({}),
}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
}))

jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const ROWS = Array.from({ length: 100 }, (_, i) => `row ${i}`)

function List({ filter }: { filter: string }) {
  const rows = ROWS.filter((r) => r.includes(filter))
  const page = usePaged(rows, filter)
  return (
    <Screen title="History" onEndReached={page.more}>
      {page.rows.map((r) => (
        <Text key={r}>{r}</Text>
      ))}
      {page.hasMore && <MoreRows />}
    </Screen>
  )
}

const scrollToEnd = (height: number) =>
  fireEvent.scroll(
    screen.UNSAFE_getByType(require("react-native").ScrollView),
    {
      nativeEvent: {
        contentOffset: { y: height - 800 },
        contentSize: { height, width: 390 },
        layoutMeasurement: { height: 800, width: 390 },
      },
    },
  )

test("only the first page renders, and the next one near the end", () => {
  render(<List filter="" />, { wrapper })
  expect(screen.getByText("row 14")).toBeTruthy()
  expect(screen.queryByText("row 15")).toBeNull()
  expect(screen.getByLabelText("Loading more")).toBeTruthy()
  act(() => scrollToEnd(3000))
  expect(screen.getByText("row 44")).toBeTruthy()
  expect(screen.queryByText("row 45")).toBeNull()
})

test("scrolling far from the end adds nothing", () => {
  render(<List filter="" />, { wrapper })
  fireEvent.scroll(
    screen.UNSAFE_getByType(require("react-native").ScrollView),
    {
      nativeEvent: {
        contentOffset: { y: 0 },
        contentSize: { height: 3000, width: 390 },
        layoutMeasurement: { height: 800, width: 390 },
      },
    },
  )
  expect(screen.queryByText("row 15")).toBeNull()
})

test("a new filter starts from its first page", () => {
  const view = render(<List filter="" />, { wrapper })
  act(() => scrollToEnd(3000))
  expect(screen.getByText("row 44")).toBeTruthy()
  view.rerender(<List filter="row 1" />)
  // "row 1", "row 10".."row 19": 11 rows, all on the first page.
  expect(screen.getByText("row 19")).toBeTruthy()
  expect(screen.queryByLabelText("Loading more")).toBeNull()
  view.rerender(<List filter="" />)
  expect(screen.queryByText("row 15")).toBeNull()
})

test("the last page shows no placeholder", () => {
  render(<List filter="" />, { wrapper })
  for (const h of [3000, 6000, 9000, 12000]) act(() => scrollToEnd(h))
  expect(screen.getByText("row 99")).toBeTruthy()
  expect(screen.queryByLabelText("Loading more")).toBeNull()
})

test("groupBy keeps each group's rows in order, in one pass", () => {
  const g = groupBy(["a1", "b1", "a2"], (s) => s[0])
  expect([...g.entries()]).toEqual([
    ["a", ["a1", "a2"]],
    ["b", ["b1"]],
  ])
})
