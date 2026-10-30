import type { Trophy } from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { captureUi } from "@domain/lib/capture"
import { dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import * as Haptics from "expo-haptics"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { resetPresented, TrophyQueue } from "../trophy-overlay"

const mockMotion = { reduced: false }
const mockPath = { current: "/today" }
const mockLocal: { trophies: Trophy[] } = { trophies: [] }
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}))
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => mockPath.current,
}))
jest.mock("@domain/dash/hooks", () => ({
  ...jest.requireActual("@domain/dash/hooks"),
  useTrophies: () => mockLocal.trophies,
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
  useReducedMotion: () => mockMotion.reduced,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const push = router.push as jest.Mock

const trophy = (id: string, day = dayOffset(0)): Trophy => ({
  id,
  type: "streak",
  title: `Title ${id}`,
  value: "7d",
  detail: `Detail ${id}`,
  day,
  href: "/stats/trophies",
})
const seen = () => dashStore.get().seenTrophies
/** Let the medal land (its text and buttons follow). */
const land = () => act(() => jest.advanceTimersByTime(700))
const nice = () => {
  fireEvent.press(screen.getByText("Nice"))
  act(() => jest.advanceTimersByTime(450))
  land()
}

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetPresented()
  dashStore.set((s) => ({ ...s, seenTrophies: [] }))
  captureUi.set({ open: false, ctx: {} })
  mockMotion.reduced = false
  mockPath.current = "/today"
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

test("a new trophy presents; Nice marks it seen and closes", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(screen.getByTestId("trophy-overlay")).toBeTruthy()
  land()
  expect(screen.getByText("Title a")).toBeTruthy()
  expect(screen.getByText("Detail a")).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
  fireEvent.press(screen.getByText("Nice"))
  expect(seen()).toEqual(["a"])
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("View opens the Trophy case on that trophy and marks it seen", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  land()
  fireEvent.press(screen.getByText("View"))
  expect(push).toHaveBeenCalledWith("/stats/trophies?open=a")
  expect(seen()).toEqual(["a"])
})

test("two trophies present one after the other, oldest first", () => {
  render(<TrophyQueue trophies={[trophy("b"), trophy("a", dayOffset(-1))]} />, {
    wrapper,
  })
  land()
  expect(screen.getByText("Title a")).toBeTruthy()
  nice()
  expect(screen.getByText("Title b")).toBeTruthy()
  fireEvent.press(screen.getByText("Nice"))
  expect(seen().sort()).toEqual(["a", "b"])
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("five qualify: three present, the third offers See all, all five are seen", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => trophy(id))
  const view = render(<TrophyQueue trophies={five} />, { wrapper })
  land()
  nice()
  nice()
  expect(screen.getByText("Title c")).toBeTruthy()
  expect(screen.getByText("See all 5 new")).toBeTruthy()
  fireEvent.press(screen.getByText("Nice"))
  expect(seen().sort()).toEqual(["a", "b", "c", "d", "e"])
  // The same five on the next refetch present nothing.
  view.rerender(<TrophyQueue trophies={[...five]} />)
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("See all marks every qualifying trophy and opens the Trophy case", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => trophy(id))
  render(<TrophyQueue trophies={five} />, { wrapper })
  land()
  nice()
  nice()
  fireEvent.press(screen.getByText("See all 5 new"))
  expect(push).toHaveBeenCalledWith("/stats/trophies")
  expect(seen().sort()).toEqual(["a", "b", "c", "d", "e"])
})

test("an old unseen trophy never presents", () => {
  render(<TrophyQueue trophies={[trophy("old", dayOffset(-7))]} />, {
    wrapper,
  })
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
  expect(seen()).toEqual([])
})

test("a trophy already seen (e.g. on another device) does not present", () => {
  dashStore.set((s) => ({ ...s, seenTrophies: ["a"] }))
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("nothing presents before a successful load", () => {
  render(<TrophyQueue trophies={undefined} />, { wrapper })
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("it waits on the Trophy case, the Fern drawer or a full-screen view", () => {
  mockPath.current = "/stats/trophies"
  const view = render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
  mockPath.current = "/today"
  act(() => captureUi.set({ open: true, ctx: {} }))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
  act(() => captureUi.set({ open: false, ctx: {} }))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} hidden />)
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  expect(screen.getByTestId("trophy-overlay")).toBeTruthy()
})

test("a dismissed trophy refetched again does not present twice", () => {
  const view = render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  land()
  fireEvent.press(screen.getByText("Nice"))
  // Even if the seen mark had not landed yet, this launch presented it.
  dashStore.set((s) => ({ ...s, seenTrophies: [] }))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  expect(screen.queryByTestId("trophy-overlay")).toBeNull()
})

test("reduced motion: usable at once, the text already there", () => {
  mockMotion.reduced = true
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(screen.getByText("Title a")).toBeTruthy()
  fireEvent.press(screen.getByText("Nice"))
  expect(seen()).toEqual(["a"])
})

test("prototype mode reads the trophies the device computes", () => {
  const { TrophyWatcher } = require("../trophy-overlay")
  mockLocal.trophies = [trophy("local")]
  render(<TrophyWatcher />, { wrapper })
  land()
  expect(screen.getByText("Title local")).toBeTruthy()
})
