// The tour's saved state: kept per account, mirrored to the funnel, and the
// one-time tips never come back once shown.
import { configureStorage } from "@domain/lib/store"
import { funnelStore, setFunnelSender } from "../funnel"
import { sessionStore } from "../session"
import {
  dispatchTour,
  markTip,
  queueTour,
  resetTips,
  startQueuedTour,
  tipSeen,
  tourOf,
  tourStore,
} from "../tour/store"

const signIn = (email: string) =>
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "A", username: "a", email },
  }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  jest.useFakeTimers()
  funnelStore.set({ installId: "", queue: [] })
  // A sender makes logFunnel queue in prototype mode.
  setFunnelSender(async () => {})
  tourStore.set({ users: {} })
  signIn("kai@example.com")
})
afterEach(() => {
  jest.useRealTimers()
  setFunnelSender(null)
})

const steps = () => funnelStore.get().queue.map((q) => `${q.event}:${q.step}`)

test("a queued tour starts once, on the first step", () => {
  queueTour()
  expect(tourOf().queued).toBe(true)
  expect(startQueuedTour()).toBe(true)
  expect(tourOf().tour.status).toBe("running")
  expect(tourOf().queued).toBe(false)
  expect(startQueuedTour()).toBe(false)
})

test("nothing starts without a queued tour", () => {
  expect(startQueuedTour()).toBe(false)
  expect(tourOf().tour.status).toBe("idle")
})

test("every step shown, done or skipped reaches the funnel", () => {
  queueTour()
  startQueuedTour()
  dispatchTour({ type: "signal", signal: { kind: "logged" } })
  dispatchTour({ type: "skipStep" })
  dispatchTour({ type: "skipTour" })
  expect(steps()).toEqual([
    "step_view:tour_fern",
    "step_complete:tour_fern",
    "step_view:tour_tick",
    "step_skip:tour_tick",
    "step_view:tour_plan",
    "step_skip:tour_plan",
    "step_skip:tour_stats",
    "step_skip:tour_remind",
  ])
})

test("the tour is kept per account", () => {
  queueTour()
  startQueuedTour()
  dispatchTour({ type: "skipTour" })
  signIn("someone@example.com")
  expect(tourOf().tour.status).toBe("idle")
  signIn("KAI@example.com")
  expect(tourOf().tour.ended).toBe("skipped")
})

test("replay after the tour ended starts it again", () => {
  queueTour()
  startQueuedTour()
  dispatchTour({ type: "skipTour" })
  queueTour()
  expect(startQueuedTour()).toBe(true)
  expect(tourOf().tour.index).toBe(0)
  expect(tourOf().tour.status).toBe("running")
})

test("a tip shows once per account, until tips are reset", () => {
  expect(tipSeen("finance")).toBe(false)
  markTip("finance")
  expect(tipSeen("finance")).toBe(true)
  expect(tipSeen("nutrition")).toBe(false)
  signIn("other@example.com")
  expect(tipSeen("finance")).toBe(false)
  signIn("kai@example.com")
  resetTips()
  expect(tipSeen("finance")).toBe(false)
})
