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
import { anchor, OverlayHost, resetOverlay } from "../overlay"
import {
  presentedStore,
  resetPresented,
  TROPHY_MS,
  TrophyQueue,
} from "../trophy-overlay"

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
const mockServer: { status: string; source: string } = {
  status: "off",
  source: "local",
}
jest.mock("@domain/dash/server-stats", () => ({
  ...jest.requireActual("@domain/dash/server-stats"),
  useServerStat: () => ({ data: undefined, ...mockServer }),
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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
// The card draws in the top layer, as in the app.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
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
const card = () => screen.queryByTestId("trophy-overlay")
/** One card's stay plus the gap before the next. */
const pass = () => {
  act(() => jest.advanceTimersByTime(TROPHY_MS))
  act(() => jest.advanceTimersByTime(350))
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
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 0, height: 0 })
  dashStore.set((s) => ({ ...s, seenTrophies: [] }))
  captureUi.set({ open: false, ctx: {} })
  mockMotion.reduced = false
  mockPath.current = "/today"
  mockServer.status = "off"
  mockServer.source = "local"
  mockLocal.trophies = []
  jest.clearAllMocks()
})
afterEach(() => jest.useRealTimers())

test("a new trophy lands as a card that says what was earned", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(card()).toBeTruthy()
  expect(screen.getByText("Trophy earned")).toBeTruthy()
  expect(screen.getByText("Title a")).toBeTruthy()
  expect(screen.getByText("Detail a")).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
})

test("it is marked the moment it lands, and leaves on its own", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(seen()).toEqual(["a"])
  expect(presentedStore.get().ids).toEqual(["a"])
  act(() => jest.advanceTimersByTime(TROPHY_MS - 100))
  expect(card()).toBeTruthy()
  act(() => jest.advanceTimersByTime(200))
  expect(card()).toBeNull()
})

test("it draws over everything without blocking the screen", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  const layer = screen.getByTestId("overlay-layer")
  let node = card()?.parent
  while (node && node !== layer) node = node.parent
  expect(node).toBe(layer)
  // The layer and the card's frame pass touches through; only the card
  // itself takes them.
  expect(layer.props.pointerEvents).toBe("box-none")
  let frame = card()?.parent
  while (frame && frame.props.pointerEvents === undefined) frame = frame.parent
  expect(frame?.props.pointerEvents).toBe("box-none")
})

test("a tap opens that trophy in the Trophy case", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  fireEvent.press(screen.getByRole("button"))
  expect(push).toHaveBeenCalledWith("/stats/trophies?open=a")
  expect(card()).toBeNull()
})

test("two trophies land one after the other, oldest first", () => {
  render(<TrophyQueue trophies={[trophy("b"), trophy("a", dayOffset(-1))]} />, {
    wrapper,
  })
  expect(screen.getByText("Title a")).toBeTruthy()
  pass()
  expect(screen.getByText("Title b")).toBeTruthy()
  pass()
  expect(card()).toBeNull()
  expect(seen().sort()).toEqual(["a", "b"])
})

test("five qualify: three cards, the third counts the rest and opens the case", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => trophy(id))
  const view = render(<TrophyQueue trophies={five} />, { wrapper })
  expect(seen().sort()).toEqual(["a", "b", "c", "d", "e"])
  pass()
  pass()
  expect(screen.getByText("Title c")).toBeTruthy()
  expect(screen.getByText("Trophy earned · 2 more")).toBeTruthy()
  fireEvent.press(screen.getByRole("button"))
  expect(push).toHaveBeenCalledWith("/stats/trophies")
  // The same five on the next refetch present nothing.
  view.rerender(<TrophyQueue trophies={[...five]} />)
  expect(card()).toBeNull()
})

test("an old unseen trophy never presents", () => {
  render(<TrophyQueue trophies={[trophy("old", dayOffset(-7))]} />, {
    wrapper,
  })
  expect(card()).toBeNull()
  expect(seen()).toEqual([])
})

test("a trophy already seen (e.g. on another device) does not present", () => {
  dashStore.set((s) => ({ ...s, seenTrophies: ["a"] }))
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(card()).toBeNull()
})

test("relaunching never replays it, even if a pull reset the seen list", () => {
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper }).unmount()
  resetOverlay()
  // An older copy of the synced seen list arrives after the mark.
  dashStore.set((s) => ({ ...s, seenTrophies: [] }))
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(card()).toBeNull()
})

test("one newly earned on a later sync lands; the earlier one does not again", () => {
  const view = render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  pass()
  view.rerender(<TrophyQueue trophies={[trophy("a"), trophy("b")]} />)
  expect(screen.getByText("Title b")).toBeTruthy()
  expect(screen.queryByText("Title a")).toBeNull()
})

test("nothing presents before a successful load", () => {
  render(<TrophyQueue trophies={undefined} />, { wrapper })
  expect(card()).toBeNull()
})

test("it waits on the Trophy case, the Fern drawer or a full-screen view", () => {
  mockPath.current = "/stats/trophies"
  const view = render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(card()).toBeNull()
  mockPath.current = "/today"
  act(() => captureUi.set({ open: true, ctx: {} }))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  expect(card()).toBeNull()
  act(() => captureUi.set({ open: false, ctx: {} }))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} hidden />)
  expect(card()).toBeNull()
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  expect(card()).toBeTruthy()
})

test("its clock stops while something hides it", () => {
  const view = render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  act(() => jest.advanceTimersByTime(TROPHY_MS - 500))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} hidden />)
  act(() => jest.advanceTimersByTime(TROPHY_MS * 2))
  view.rerender(<TrophyQueue trophies={[trophy("a")]} />)
  // Back in full: a fresh stay, not the leftover half second.
  act(() => jest.advanceTimersByTime(TROPHY_MS - 100))
  expect(card()).toBeTruthy()
})

test("reduced motion: the card still lands and leaves", () => {
  mockMotion.reduced = true
  render(<TrophyQueue trophies={[trophy("a")]} />, { wrapper })
  expect(screen.getByText("Title a")).toBeTruthy()
  expect(Haptics.notificationAsync).toHaveBeenCalledWith("success")
  pass()
  expect(card()).toBeNull()
})

test("prototype mode reads the trophies the device computes", () => {
  const { TrophyWatcher } = require("../trophy-overlay")
  mockLocal.trophies = [trophy("local")]
  render(<TrophyWatcher />, { wrapper })
  expect(screen.getByText("Title local")).toBeTruthy()
})

test("signed in, it waits for the server's answer before presenting", () => {
  const { TrophyWatcher } = require("../trophy-overlay")
  mockLocal.trophies = [trophy("local")]
  mockServer.status = "loading"
  const view = render(<TrophyWatcher />, { wrapper })
  expect(card()).toBeNull()
  expect(seen()).toEqual([])
  mockServer.status = "ready"
  mockServer.source = "server"
  view.rerender(<TrophyWatcher />)
  expect(screen.getByText("Title local")).toBeTruthy()
})
