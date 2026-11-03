// Treadmill sessions on screen: choosing Treadmill starts without GPS; the
// record shows a treadmill instead of a map, takes the machine's distance
// and incline, and compares its pace only with other treadmill sessions; a
// GPS walk that was really on a treadmill can be switched, with Undo.

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

const walk = (over: Partial<RunSession> = {}): RunSession => ({
  id: "w1",
  kind: "walk",
  name: "Morning walk",
  startedAt: "2026-11-02T23:00:00.000Z",
  endedAt: "2026-11-02T23:40:00.000Z",
  movingSec: 2400,
  distanceM: 500,
  elevationGainM: 34,
  steps: 2075,
  kcal: 30,
  route: [
    [14.5, 121, 10, 0],
    [14.5001, 121, 44, 1200],
  ],
  splits: [],
  ...over,
})
const treadmill = (over: Partial<RunSession> = {}) =>
  walk({ indoor: true, route: [], elevationGainM: undefined, ...over })

it("choosing Treadmill starts the walk without GPS", async () => {
  render(<RunScreen />, { wrapper })
  fireEvent.press(screen.getByLabelText("Walk"))
  fireEvent.press(screen.getByLabelText("Treadmill"))
  await act(async () => {
    fireEvent.press(screen.getByText("Start treadmill walk"))
  })
  expect(mockStartTracking).not.toHaveBeenCalled()
  // Health is still asked for: it gives the treadmill's distance.
  expect(mockConnectHealth).toHaveBeenCalled()
  expect(RL.runLiveStore.get().active).toMatchObject({
    kind: "walk",
    indoor: true,
  })
  // The live screen shows the treadmill, not a map or a GPS chip.
  expect(screen.getByTestId("treadmill")).toBeTruthy()
  expect(screen.queryByText(/GPS/)).toBeNull()
})

it("a treadmill record shows the machine, its incline, and no climb", () => {
  fitStore.set((s) => ({ ...s, runs: [treadmill({ inclinePct: 4.5 })] }))
  render(<RunDetail id="w1" />, { wrapper })
  expect(screen.getByTestId("treadmill")).toBeTruthy()
  expect(screen.getByText("4.5% incline")).toBeTruthy()
  expect(screen.queryByText(/m climb/)).toBeNull()
  fireEvent.press(screen.getByText("How calories are estimated"))
  expect(screen.getByText(/treadmill/)).toBeTruthy()
})

it("entering the treadmill's distance and incline re-estimates calories, with Undo", () => {
  fitStore.set((s) => ({ ...s, runs: [treadmill()] }))
  render(<RunDetail id="w1" />, { wrapper })
  fireEvent.press(screen.getByLabelText("Edit treadmill distance and incline"))
  fireEvent.changeText(screen.getByLabelText("Distance"), "3")
  fireEvent.changeText(screen.getByLabelText("Incline"), "5")
  fireEvent.press(screen.getByText("Save readings"))
  const r = R.runsOf(fitStore.get())[0]
  // 75 m/min at 5%, 70 kg assumed: 14.25 × 70 × 40 / 200 = 199.5 → 200.
  expect(r).toMatchObject({ distanceM: 3000, inclinePct: 5, kcal: 200 })
  expect(toast).toHaveBeenCalledWith(
    "Treadmill readings saved",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  const undo = (toast as unknown as jest.Mock).mock.calls.at(-1)[1].action
    .onClick
  act(() => undo())
  expect(R.runsOf(fitStore.get())[0].distanceM).toBe(500)
})

it("a GPS walk that was on a treadmill is switched, with Undo in the sheet", () => {
  fitStore.set((s) => ({ ...s, runs: [walk()] }))
  render(<RunDetail id="w1" />, { wrapper })
  fireEvent.press(screen.getByText("Recorded on a treadmill?"))
  const r = R.runsOf(fitStore.get())[0]
  expect(r).toMatchObject({ indoor: true, route: [] })
  // The readings sheet opens straight away for the machine's distance.
  expect(screen.getByText("Save readings")).toBeTruthy()
  // Undo sits in the sheet, where a toast would cover the incline.
  fireEvent.press(screen.getByLabelText("Undo the switch to treadmill"))
  expect(R.runsOf(fitStore.get())[0].route).toHaveLength(2)
  expect(R.runsOf(fitStore.get())[0].indoor).toBeUndefined()
})

it("pace compares only with the last treadmill walk, and hides with none", () => {
  fitStore.set((s) => ({
    ...s,
    runs: [
      walk({ id: "o", distanceM: 1500, startedAt: "2026-10-30T23:00:00.000Z" }),
      treadmill({ id: "w1", distanceM: 3000 }),
    ],
  }))
  const first = render(<RunDetail id="w1" />, { wrapper })
  expect(screen.queryByText(/than last/)).toBeNull()
  first.unmount()
  fitStore.set((s) => ({
    ...s,
    runs: [
      treadmill({
        id: "i0",
        distanceM: 2400,
        startedAt: "2026-10-31T23:00:00.000Z",
      }),
      ...(s.runs ?? []),
    ],
  }))
  render(<RunDetail id="w1" />, { wrapper })
  // 3,000 m vs 2,400 m in 40 min: 13:20 vs 16:40 /km, 3:20 faster.
  expect(screen.getByText(/3:20 faster than last/)).toBeTruthy()
})

it("a treadmill walk is celebrated even before its distance is known", () => {
  fitStore.set((s) => ({ ...s, runs: [treadmill({ distanceM: 0 })] }))
  render(<RunDetail id="w1" summary />, { wrapper })
  expect(
    screen.queryAllByTestId("celebration-leaf", { includeHiddenElements: true })
      .length,
  ).toBeGreaterThan(0)
  expect(
    screen.getByLabelText("Edit treadmill distance and incline"),
  ).toBeTruthy()
})

it("a switch closed without saving can still be undone, from a toast", async () => {
  fitStore.set((s) => ({ ...s, runs: [walk()] }))
  render(<RunDetail id="w1" />, { wrapper })
  fireEvent.press(screen.getByText("Recorded on a treadmill?"))
  // The phone's motion distance for that time fills in once read.
  await act(async () => {})
  expect(screen.getByLabelText("Distance").props.value).toBe("2.31")
  fireEvent.press(screen.getByLabelText("Close"))
  expect(toast).toHaveBeenCalledWith(
    "Switched to treadmill",
    expect.objectContaining({
      action: expect.objectContaining({ label: "Undo" }),
    }),
  )
  const undo = (toast as unknown as jest.Mock).mock.calls.at(-1)[1].action
    .onClick
  act(() => undo())
  expect(R.runsOf(fitStore.get())[0]).toMatchObject({ distanceM: 500 })
  expect(R.runsOf(fitStore.get())[0].route).toHaveLength(2)
})

it("saving right after a switch: Undo goes back to the GPS record", async () => {
  fitStore.set((s) => ({ ...s, runs: [walk()] }))
  render(<RunDetail id="w1" />, { wrapper })
  fireEvent.press(screen.getByText("Recorded on a treadmill?"))
  await act(async () => {})
  fireEvent.press(screen.getByText("Save readings"))
  expect(R.runsOf(fitStore.get())[0]).toMatchObject({
    indoor: true,
    distanceM: 2310,
  })
  const undo = (toast as unknown as jest.Mock).mock.calls.at(-1)[1].action
    .onClick
  act(() => undo())
  const r = R.runsOf(fitStore.get())[0]
  expect(r.route).toHaveLength(2)
  expect(r.indoor).toBeUndefined()
})

it("the calorie note says when a steep incline is counted as 15%", () => {
  fitStore.set((s) => ({ ...s, runs: [treadmill({ inclinePct: 20 })] }))
  render(<RunDetail id="w1" />, { wrapper })
  fireEvent.press(screen.getByText("How calories are estimated"))
  expect(screen.getByText(/counted as 15%/)).toBeTruthy()
})
