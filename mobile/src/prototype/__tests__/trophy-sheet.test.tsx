import type { Achievement } from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Trophies } from "../screens/dash-achievements"

const mockRoute: {
  params: Record<string, string>
  path: string
  blur: (() => void) | null
} = { params: {}, path: "/stats/trophies", blur: null }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockRoute.params,
  usePathname: () => mockRoute.path,
  // Focus runs once; its cleanup is what navigating away calls.
  useFocusEffect: (run: () => (() => void) | undefined) => {
    const { useEffect } = require("react")
    useEffect(() => {
      mockRoute.blur = run() ?? null
    }, [run])
  },
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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: require("react-native").View,
}))
const mockCatalog: { current: Achievement[] } = { current: [] }
jest.mock("@domain/dash/hooks", () => ({
  ...jest.requireActual("@domain/dash/hooks"),
  useAchievements: () => mockCatalog.current,
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const push = router.push as jest.Mock
/** The sheet's modal has left (iOS reports it within 400 ms). */
const settle = () => act(() => jest.advanceTimersByTime(600))

const trophy = {
  id: "pr-month-2026-10-30",
  type: "pr" as const,
  title: "PR this month",
  value: "1",
  detail: "1 new best lift in 30 days",
  day: "2026-10-30",
  href: "/fitness/stats",
  shareRef: "pr-month",
}
const open = () => {
  mockRoute.params = { open: trophy.id }
  render(<Trophies />, { wrapper })
  expect(screen.getByText("Achievement unlocked")).toBeTruthy()
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockRoute.params = {}
  mockRoute.path = "/stats/trophies"
  mockRoute.blur = null
  mockCatalog.current = [
    {
      id: "pr-month",
      type: "pr",
      title: "PR this month",
      requirement: "Set a new best lift",
      progress: { pct: 100, text: "Done" },
      trophy,
    },
  ]
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => jest.useRealTimers())

test("View metric closes the sheet, then opens the metric", () => {
  open()
  fireEvent.press(screen.getByText("View metric ›"))
  // Nothing is pushed under a sheet that is still on screen.
  expect(push).not.toHaveBeenCalled()
  settle()
  expect(screen.queryByText("Achievement unlocked")).toBeNull()
  expect(push).toHaveBeenCalledTimes(1)
  expect(push).toHaveBeenCalledWith("/fitness/stats")
  expect(dashStore.get().seenTrophies).toContain(trophy.id)
})

test("View metric only closes the sheet when that metric is already open", () => {
  mockRoute.path = "/fitness/stats"
  open()
  fireEvent.press(screen.getByText("View metric ›"))
  settle()
  expect(screen.queryByText("Achievement unlocked")).toBeNull()
  expect(push).not.toHaveBeenCalled()
})

test("Share closes the sheet, then opens the share card", () => {
  open()
  fireEvent.press(screen.getByText("Share"))
  settle()
  expect(screen.queryByText("Achievement unlocked")).toBeNull()
  expect(push).toHaveBeenCalledWith("/stats/share?t=pr-month")
})

test("closing the sheet navigates nowhere", () => {
  open()
  fireEvent.press(screen.getByLabelText("Close"))
  settle()
  expect(screen.queryByText("Achievement unlocked")).toBeNull()
  expect(push).not.toHaveBeenCalled()
})

test("leaving the Trophy case by any route closes the sheet", () => {
  open()
  act(() => mockRoute.blur?.())
  settle()
  expect(screen.queryByText("Achievement unlocked")).toBeNull()
})
