// The tour on screen: the watcher turns real actions into finished steps
// (and the first one into the funnel's first log), the card always offers
// Skip and Skip tour, and the one-time tips match their screens.
import { captureStore } from "@domain/capture/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { funnelStore, setFunnelSender } from "../funnel"
import { sessionStore } from "../session"
import { TourLayer, TourWatcher, targetFor, tipFor } from "../tour/overlay"
import {
  dispatchTour,
  queueTour,
  startQueuedTour,
  tourOf,
  tourStore,
} from "../tour/store"

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

jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 375, height: 812 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  tourStore.set({ users: {} })
  funnelStore.set({ installId: "", queue: [] })
  setFunnelSender(async () => {})
  sessionStore.set((s) => ({
    ...s,
    returning: false,
    user: { name: "Kai", username: "kai", email: "kai@example.com" },
  }))
})
afterEach(() => setFunnelSender(null))

const addCapture = (id: string, status: "processing" | "done" = "done") =>
  act(() =>
    captureStore.set((s) => ({
      ...s,
      captures: [
        {
          id,
          at: new Date().toISOString(),
          source: "text",
          text: "ran 5k",
          status,
          clientUuid: "u-c1",
        },
        ...s.captures,
      ],
    })),
  )
const tickHabit = () =>
  act(() =>
    habitsStore.set((s) => ({
      ...s,
      logs: [
        ...s.logs,
        {
          id: `l${s.logs.length}`,
          habitId: "h1",
          day: "2026-11-12",
          status: "done",
          loggedAt: new Date().toISOString(),
          source: "manual",
        } as never,
      ],
    })),
  )

test("each step finishes on its own action, in order", () => {
  queueTour()
  startQueuedTour()
  const view = render(<TourWatcher path="/today" />, { wrapper })
  // Opening Stats during the Fern step does nothing.
  view.rerender(<TourWatcher path="/stats" />)
  view.rerender(<TourWatcher path="/today" />)
  expect(tourOf().tour.index).toBe(0)
  addCapture("c1")
  expect(tourOf().tour.done).toEqual(["fern"])
  tickHabit()
  expect(tourOf().tour.done).toEqual(["fern", "tick"])
  view.rerender(<TourWatcher path="/plan" />)
  view.rerender(<TourWatcher path="/stats" />)
  view.rerender(<TourWatcher path="/me/settings" />)
  expect(tourOf().tour).toMatchObject({
    status: "finished",
    ended: "completed",
    done: ["fern", "tick", "plan", "stats", "remind"],
  })
})

test("the first log is recorded once, with where it happened", () => {
  funnelStore.set({ installId: "", queue: [], sawWelcome: true })
  queueTour()
  startQueuedTour()
  render(<TourWatcher path="/today" />, { wrapper })
  addCapture("c1")
  tickHabit()
  const firsts = funnelStore.get().queue.filter((q) => q.event === "first_log")
  expect(firsts).toEqual([
    expect.objectContaining({ event: "first_log", step: "tour_fern" }),
  ])
})

test("a returning account's synced records are not a first log", () => {
  funnelStore.set({ installId: "", queue: [], sawWelcome: true })
  sessionStore.set((s) => ({ ...s, returning: true }))
  render(<TourWatcher path="/today" />, { wrapper })
  addCapture("c1")
  expect(
    funnelStore.get().queue.filter((q) => q.event === "first_log"),
  ).toEqual([])
})

test("a tick Fern files from a message does not finish the tick step", () => {
  queueTour()
  startQueuedTour()
  const view = render(<TourWatcher path="/today" drawerOpen />, { wrapper })
  addCapture("c1", "processing")
  expect(tourOf().tour.index).toBe(1)
  // Fern's reply files a done habit while it works, drawer open.
  tickHabit()
  expect(tourOf().tour.index).toBe(1)
  // Drawer closed but Fern still working: still not the person's tick.
  view.rerender(<TourWatcher path="/today" />)
  tickHabit()
  expect(tourOf().tour.index).toBe(1)
  // Fern done, drawer closed: a record filed right after is still Fern's.
  act(() =>
    captureStore.set((s) => ({
      ...s,
      captures: s.captures.map((c) =>
        c.id === "c1" ? { ...c, status: "done" as const } : c,
      ),
    })),
  )
  tickHabit()
  expect(tourOf().tour.index).toBe(1)
  // A moment later, the person's own tick counts.
  const later = Date.now() + 5000
  jest.spyOn(Date, "now").mockReturnValue(later)
  tickHabit()
  jest.restoreAllMocks()
  expect(tourOf().tour.done).toEqual(["fern", "tick"])
})

test("already on the page a step points at: the step is done on arrival", () => {
  queueTour()
  startQueuedTour()
  dispatchTour({ type: "skipStep" })
  const view = render(<TourWatcher path="/plan" />, { wrapper })
  // On Plan while the tick step shows; skipping it reaches Plan's step.
  act(() => dispatchTour({ type: "skipStep" }))
  view.rerender(<TourWatcher path="/plan" />)
  expect(tourOf().tour.done).toEqual(["plan"])
})

test("with no target on screen the card still shows Skip and Skip tour", () => {
  queueTour()
  startQueuedTour()
  render(<TourLayer path="/today" drawerOpen={false} barHeight={80} />, {
    wrapper,
  })
  expect(screen.getByText("Tell Fern anything")).toBeTruthy()
  expect(screen.getByLabelText("Step 1 of 5")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Skip this step"))
  expect(screen.getByText("Tick it off")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Skip tour"))
  expect(screen.queryByText("Tick it off")).toBeNull()
  expect(tourOf().tour.ended).toBe("skipped")
})

test("while Fern's drawer is open only the words stay, still skippable", () => {
  queueTour()
  startQueuedTour()
  render(<TourLayer path="/today" drawerOpen barHeight={80} />, { wrapper })
  expect(screen.getByText(/Type or say anything/)).toBeTruthy()
  expect(screen.getByLabelText("Skip tour")).toBeTruthy()
})

test("later steps wait while Fern's drawer is open, so its answer shows", () => {
  queueTour()
  startQueuedTour()
  dispatchTour({ type: "signal", signal: { kind: "logged" } })
  const view = render(<TourLayer path="/today" drawerOpen barHeight={80} />, {
    wrapper,
  })
  expect(screen.queryByText("Tick it off")).toBeNull()
  expect(screen.queryByLabelText("Skip tour")).toBeNull()
  view.rerender(<TourLayer path="/today" drawerOpen={false} barHeight={80} />)
  expect(screen.getByText("Tick it off")).toBeTruthy()
})

test("a queued tour starts when Today shows, not before", () => {
  queueTour()
  const view = render(
    <TourLayer path="/setup" drawerOpen={false} barHeight={80} />,
    { wrapper },
  )
  expect(tourOf().tour.status).toBe("idle")
  view.rerender(<TourLayer path="/today" drawerOpen={false} barHeight={80} />)
  expect(tourOf().tour.status).toBe("running")
})

test("the reminders step points at Me, then at Notifications on Me", () => {
  expect(targetFor("remind", "/today")).toBe("tab-me")
  // Without the row mounted it stays on the tab.
  expect(targetFor("remind", "/me")).toBe("tab-me")
  expect(targetFor("plan", "/today")).toBe("tab-plan")
})

test("tips belong to the deep screens only", () => {
  expect(tipFor("/finance")).toBe("finance")
  expect(tipFor("/finance/accounts")).toBeNull()
  expect(tipFor("/nutrition")).toBe("nutrition")
  expect(tipFor("/habits/abc123")).toBe("habit")
  expect(tipFor("/habits/settings")).toBeNull()
  expect(tipFor("/habits/routines")).toBeNull()
  expect(tipFor("/today")).toBeNull()
})
