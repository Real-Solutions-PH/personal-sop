// Toasts close on their own after their duration, touched or not (TestFlight
// build 14, 2026-10-29: a toast stayed on screen for good). sonner-native
// pauses a toast's timer when a touch begins and resumes it when the touch
// ends; with left-swipe dismissal a touch that barely moves (a tap or a
// press) returned before resuming, so the timer stayed paused forever. The
// fix is a patch to sonner-native (patches/), exercised here through the
// app's own toaster.
import { act, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { AppToaster } from "../toaster"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  Easing: new Proxy({}, { get: () => () => () => 0 }),
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useDerivedValue: (get: () => unknown) => ({ value: get() }),
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

// The swipe handler's callbacks, recorded so a test can play a touch through
// them: begin, then finalize once the finger lifts.
type Callback = (event?: unknown) => void
const pans: Record<string, Callback>[] = []
jest.mock("react-native-gesture-handler", () => {
  const builder = (record: Record<string, Callback>) => {
    const self: object = new Proxy(
      {},
      {
        get: (_, name: string) => (fn: Callback) => {
          record[name] = fn
          return self
        },
      },
    )
    return self
  }
  return {
    Gesture: {
      Pan: () => {
        const record: Record<string, Callback> = {}
        pans.push(record)
        return builder(record)
      },
      Tap: () => builder({}),
      Race: () => ({}),
    },
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})

const DURATION = 4000
// sonner-native adds its entering animation to the first timeout.
const ENTERING = 300

function renderToaster() {
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <AppToaster />
    </SafeAreaProvider>,
  )
}

/** The swipe handler of the most recently rendered toast. */
const latestPan = () => pans[pans.length - 1]

beforeEach(() => {
  jest.useFakeTimers()
  pans.length = 0
  renderToaster()
})
afterEach(() => {
  act(() => toast.dismiss())
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

test("an untouched toast closes after its duration", () => {
  act(() => toast("Saved", { duration: DURATION }))
  expect(screen.getByText("Saved")).toBeTruthy()

  act(() => jest.advanceTimersByTime(ENTERING + DURATION + 1000))
  expect(screen.queryByText("Saved")).toBeNull()
})

test("a toast still closes after a tap or press on it", () => {
  act(() => toast("Saved", { duration: DURATION }))
  act(() => jest.advanceTimersByTime(1000))

  // A tap: the touch begins and lifts without moving.
  act(() => latestPan().onBegin())
  act(() => latestPan().onFinalize())

  act(() => jest.advanceTimersByTime(ENTERING + DURATION + 1000))
  expect(screen.queryByText("Saved")).toBeNull()
})

test("a toast still closes after a swipe that springs back", () => {
  act(() => toast("Saved", { duration: DURATION }))
  act(() => jest.advanceTimersByTime(1000))

  // Dragged left less than the dismiss threshold, then released.
  act(() => latestPan().onBegin())
  act(() => latestPan().onChange({ translationX: -40 }))
  act(() => latestPan().onFinalize())

  act(() => jest.advanceTimersByTime(ENTERING + DURATION + 1000))
  expect(screen.queryByText("Saved")).toBeNull()
})
