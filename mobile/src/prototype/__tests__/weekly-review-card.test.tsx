// Today's weekly review card: pinned until the review is opened, then gone
// a day later (never before it is opened), and a tap opens that week's
// review. Plus Settings → Sections order, which places Today's cards.

import {
  MODULE_KEYS,
  orderModules,
  REVIEW_CARD_MS,
  reviewCardShown,
  weekStartKey,
} from "@domain/dash/data"
import { dashStore, moveModule, saveReview } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { reviewMapper } from "@/live/mappers/dash"
import { modulePrefMapper } from "@/live/mappers/reference"
import { AppLauncher } from "../app-launcher"
import { Settings } from "../screens/dash-profile"
import { WeeklyReviewCard, weekMood } from "../weekly-review-card"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
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
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const USER = "8a1f6a52-2c36-4b8f-9d34-3b1f5f0f2a11"
const HOUR = 60 * 60 * 1000
const id = () => `w-${weekStartKey(1)}`
const card = () => screen.queryByLabelText(/^Weekly review, /)
const at = (msAgo: number, now: number) => new Date(now - msAgo).toISOString()

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

describe("lifecycle", () => {
  const now = Date.parse("2026-11-03T09:00:00+08:00")
  test("an unopened review shows, however old", () => {
    expect(reviewCardShown(undefined, now)).toBe(true)
    expect(reviewCardShown({ done: false }, now)).toBe(true)
  })
  test("an opened review shows for one day after opening", () => {
    expect(reviewCardShown({ done: false, openedAt: at(HOUR, now) }, now)).toBe(
      true,
    )
    expect(
      reviewCardShown(
        { done: false, openedAt: at(REVIEW_CARD_MS - 1, now) },
        now,
      ),
    ).toBe(true)
    expect(
      reviewCardShown({ done: false, openedAt: at(REVIEW_CARD_MS, now) }, now),
    ).toBe(false)
    expect(
      reviewCardShown({ done: false, openedAt: at(25 * HOUR, now) }, now),
    ).toBe(false)
  })
  test("a review marked done before opens were tracked counts from done", () => {
    expect(
      reviewCardShown({ done: true, doneAt: at(2 * HOUR, now) }, now),
    ).toBe(true)
    expect(
      reviewCardShown({ done: true, doneAt: at(30 * HOUR, now) }, now),
    ).toBe(false)
  })
})

describe("the card", () => {
  test("shows last week's review unopened, with the AI's read", () => {
    render(<WeeklyReviewCard now={Date.now()} />, { wrapper })
    expect(card()).toBeTruthy()
    expect(screen.getByText(/^You hit the target on \d+ of \d+/)).toBeTruthy()
  })

  test("Fern says the read, in the week's mood", () => {
    render(<WeeklyReviewCard now={Date.now()} />, { wrapper })
    expect(card()?.props.accessibilityLabel).toMatch(/\. Fern: You hit /)
    expect(
      screen.getByTestId(/^fern-(celebrating|consoling|idle)$/, {
        includeHiddenElements: true,
      }),
    ).toBeTruthy()
    // Up on the week before is a win and down is a miss, whatever the rate.
    expect(weekMood(0.4, 6, 0.7)).toBe("celebrating")
    expect(weekMood(0.9, -12, 0.7)).toBe("consoling")
    // Level with it: the bar decides; no rate yet is neither.
    expect(weekMood(0.7, 0, 0.7)).toBe("celebrating")
    expect(weekMood(0.5, null, 0.7)).toBe("consoling")
    expect(weekMood(null, null, 0.7)).toBe("idle")
  })

  test("a tap opens that week's review and starts the one-day clock", () => {
    render(<WeeklyReviewCard now={Date.now()} />, { wrapper })
    const before = Date.now()
    fireEvent.press(card()!)
    expect(router.push).toHaveBeenCalledWith(`/stats/reviews/${id()}`)
    const opened = dashStore.get().reviews[id()]?.openedAt
    expect(opened && Date.parse(opened)).toBeGreaterThanOrEqual(before - 1000)
    // A second open does not restart the clock.
    saveReview(id(), { openedAt: "2026-01-01T00:00:00.000Z" })
    fireEvent.press(card() ?? screen.getByText(/Weekly review/))
    expect(dashStore.get().reviews[id()]?.openedAt).toBe(
      "2026-01-01T00:00:00.000Z",
    )
  })

  test("stays within a day of opening and leaves after it", () => {
    const now = Date.now()
    saveReview(id(), { openedAt: at(23 * HOUR, now) })
    const within = render(<WeeklyReviewCard now={now} />, { wrapper })
    expect(card()).toBeTruthy()
    within.unmount()
    saveReview(id(), { openedAt: at(24 * HOUR + 1, now) })
    render(<WeeklyReviewCard now={now} />, { wrapper })
    expect(card()).toBeNull()
  })

  test("opening the review page itself also counts as opened", () => {
    const { Reviews } = require("../screens/dash-reviews")
    render(<Reviews id={id()} />, { wrapper })
    expect(dashStore.get().reviews[id()]?.openedAt).toBeTruthy()
  })

  test("Today pins it above everything", () => {
    jest.useFakeTimers({ now: new Date(`${dayKey()}T09:30:00`) })
    const { Today } = require("../screens/today")
    render(<Today />, { wrapper })
    // Today's summary cards render a frame after the page itself.
    act(() => jest.advanceTimersByTime(200))
    expect(card()).toBeTruthy()
    // The old bottom-of-Today nudge gave way to the card.
    expect(screen.queryByText("Weekly review is ready")).toBeNull()
    jest.useRealTimers()
  })
})

describe("section order", () => {
  test("moving a section persists the whole order", () => {
    moveModule("finance", 0)
    expect(dashStore.get().order).toEqual([
      "finance",
      ...MODULE_KEYS.filter((k) => k !== "finance"),
    ])
    moveModule("habits", 99)
    expect(orderModules(dashStore.get().order).at(-1)).toBe("habits")
  })

  test("an unknown or missing module keeps its default place", () => {
    expect(orderModules(undefined)).toEqual(MODULE_KEYS)
    expect(orderModules(["tasks", "nope", "tasks"])).toEqual([
      "tasks",
      ...MODULE_KEYS.filter((k) => k !== "tasks"),
    ])
  })

  test("Settings lists sections in the saved order, with no sort grips", () => {
    moveModule("finance", 0)
    render(<Settings />, { wrapper })
    // Order is set in Edit Home; Settings only shows it.
    expect(screen.queryAllByLabelText(/^Reorder /)).toHaveLength(0)
    const names = screen
      .getAllByRole("switch", { name: /^(Habits|Finance)$/ })
      .map((n) => n.props.accessibilityLabel)
    expect(names).toEqual(["Finance", "Habits"])
    fireEvent.press(screen.getByRole("switch", { name: "Journal" }))
  })

  test("Today and Your apps follow the order", () => {
    moveModule("finance", 0)
    const apps = render(<AppLauncher />, { wrapper })
    const names = screen
      .getAllByLabelText(/^(Habits|Finance)$/)
      .map((n) => n.props.accessibilityLabel)
    expect(names).toEqual(["Finance", "Habits"])
    apps.unmount()
    jest.useFakeTimers({ now: new Date(`${dayKey()}T09:30:00`) })
    const { Today } = require("../screens/today")
    render(<Today />, { wrapper })
    const titles = screen
      .getAllByText(/^(Habits|Finance)$/)
      .map((n) => n.props.children)
    // Card titles come last in the tree (after the launcher and ring rows).
    expect(titles.lastIndexOf("Finance")).toBeLessThan(
      titles.lastIndexOf("Habits"),
    )
    jest.useRealTimers()
  })
})

describe("sync", () => {
  test("the order rides on each module row and comes back", () => {
    moveModule("finance", 0)
    const m = modulePrefMapper(USER)
    const rows = m.list(dashStore.get())
    const finance = rows.find((r) => r.module === "finance")!
    expect(m.toServer(finance, dashStore.get())).toMatchObject({
      sort_order: 0,
    })
    expect(
      m.toServer(rows.find((r) => r.module === "habits")!, dashStore.get()),
    ).toMatchObject({
      sort_order: 1,
    })
    // Another device moved Focus to the top.
    const pulled = MODULE_KEYS.map((k, i) =>
      m.fromServer(
        {
          id: `x-${k}`,
          module: k,
          enabled: true,
          weight: 2,
          sort_order: k === "focus" ? 0 : i + 1,
        },
        dashStore.get(),
      ),
    ).filter((r) => r !== null)
    const next = m.merge(dashStore.get(), pulled, [])
    expect(orderModules(next.order)[0]).toBe("focus")
  })

  test("rows nobody reordered keep the default order", () => {
    const m = modulePrefMapper(USER)
    const pulled = MODULE_KEYS.map((k) =>
      m.fromServer(
        { id: k, module: k, enabled: true, weight: 2 },
        dashStore.get(),
      ),
    ).filter((r) => r !== null)
    const next = m.merge(dashStore.get(), pulled, [])
    expect(next.order).toBeUndefined()
    expect(orderModules(next.order)).toEqual(MODULE_KEYS)
  })

  test("a review's first open syncs both ways", () => {
    const m = reviewMapper(USER)
    saveReview(id(), { openedAt: "2026-11-03T01:30:00.000Z" })
    const row = m.list(dashStore.get()).find((r) => r.key === id())!
    expect(m.toServer(row, dashStore.get())).toMatchObject({
      opened_at: "2026-11-03T01:30:00.000Z",
    })
    const back = m.fromServer(
      {
        id: "r1",
        key: id(),
        done: false,
        opened_at: "2026-11-02T00:00:00Z",
      },
      dashStore.get(),
    )
    expect(back?.value.openedAt).toBe("2026-11-02T00:00:00Z")
  })
})
