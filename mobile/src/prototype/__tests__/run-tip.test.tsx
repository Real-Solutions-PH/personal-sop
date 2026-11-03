// The phone-placement tip on a session in progress: worded for the
// treadmill or outdoors, its detail in a sheet, and dismissed for good with
// the detail still under an info icon.
import type { RunSession } from "@domain/fitness/data"
import * as RL from "@domain/fitness/run-live"
import * as R from "@domain/fitness/runs"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { anchor, OverlayHost, resetOverlay } from "../overlay"

const mockPath = { current: "/today" }
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => mockParams,
  usePathname: () => mockPath.current,
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
  withSequence: (...v: unknown[]) => v.at(-1),
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => false,
  isSharedValue: () => false,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  selectionAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
const mockStartTracking = jest.fn(async () => ({
  ok: true as const,
  background: true,
}))
const mockConnectHealth = jest.fn(async () => true)
const mockWindow = { steps: 2900, hr: null, distanceM: 2310 }
jest.mock("../health", () => ({
  ...jest.requireActual("../health"),
  healthAvailable: () => true,
  connectHealth: () => mockConnectHealth(),
  readWindow: async () => mockWindow,
}))
jest.mock("../run-tracker", () => ({
  finishAndStop: jest.fn(),
  startTracking: () => mockStartTracking(),
  stopTracking: jest.fn(),
}))

const mockParams: { kind?: string } = {}
const { celebrateStore } =
  require("../celebration") as typeof import("../celebration")
const { RunDetail, RunScreen } =
  require("../screens/fitness-runs") as typeof import("../screens/fitness-runs")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>
    {children}
    <OverlayHost />
  </SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  anchor.measure = (_, done) => done({ x: 0, y: 0, width: 40, height: 40 })
  fitStore.set((s) => ({ ...s, weighIns: [], runs: [] }))
  celebrateStore.set({ ids: [] })
  jest.clearAllMocks()
})

const tipStore = () =>
  (
    require("../screens/fitness-runs") as typeof import("../screens/fitness-runs")
  ).runTipStore

it("a treadmill walk in progress says where to keep the phone, with the detail a tap away", () => {
  RL.startRun("walk", Date.now() - 60_000, { indoor: true })
  render(<RunScreen />, { wrapper })
  expect(
    screen.getByText(
      /Keep your phone in a pocket or clipped to your waistband/,
    ),
  ).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Where to keep your phone"))
  expect(screen.getByText(/Motion Calibration & Distance/)).toBeTruthy()
  expect(screen.getByText(/On the console/)).toBeTruthy()
})

it("outdoors the tip is about the pocket and the sky", () => {
  RL.startRun("walk", Date.now() - 60_000)
  render(<RunScreen />, { wrapper })
  expect(screen.getByText(/GPS just needs a view of the sky/)).toBeTruthy()
})

it("with a watch counting, the treadmill tip says holding the rails stops it", () => {
  RL.startRun("walk", Date.now() - 60_000, { indoor: true })
  RL.setRunHealth({ hr: { avg: 110, max: 120, last: 115 } })
  render(<RunScreen />, { wrapper })
  expect(screen.getByText(/holding the rails/i)).toBeTruthy()
})

it("dismissed, the tip stays hidden but its detail is still under the info icon", () => {
  RL.startRun("walk", Date.now() - 60_000, { indoor: true })
  const first = render(<RunScreen />, { wrapper })
  fireEvent.press(screen.getByLabelText("Hide this tip"))
  expect(screen.queryByText(/Keep your phone in a pocket/)).toBeNull()
  expect(tipStore().get().dismissed).toBe(true)
  first.unmount()
  render(<RunScreen />, { wrapper })
  expect(screen.queryByText(/Keep your phone in a pocket/)).toBeNull()
  fireEvent.press(screen.getByLabelText("Phone placement tips"))
  expect(screen.getByText(/Motion Calibration & Distance/)).toBeTruthy()
})
