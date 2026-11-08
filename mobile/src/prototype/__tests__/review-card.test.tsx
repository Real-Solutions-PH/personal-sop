// Fern's review card: wins first, at most two gaps, one-tap "make it a
// habit / task" that confirms inline (no toast), dismissable suggestions
// remembered for 30 days, and the three fetch states.
import {
  daysForWeek,
  dismissedTitles,
  dismissSuggestion,
  type ReviewOut,
  reviewDismissStore,
  reviewRules,
} from "@domain/companion/review-rules"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { tasksStore } from "@domain/tasks/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { FernReviewView } from "../companion/review-card"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
  cancelAnimation: () => {},
  Easing: new Proxy({}, { get: () => () => () => 0 }),
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
  useFocusEffect: () => {},
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  </QueryClientProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  habitsStore.set((s) => ({ ...s, habits: [] }))
  tasksStore.set((s) => ({ ...s, tasks: [] }))
  reviewDismissStore.set({ dismissed: [] })
  jest.clearAllMocks()
})

const LONG =
  "A ten-minute walk right after lunch, before you open the laptop again, three days a week"
const review: ReviewOut = {
  source: "ai",
  wins: [{ text: "You read on four days." }],
  gaps: [
    {
      text: "Walks slipped after Tuesday.",
      how: "Tie it to lunch.",
      suggestion: {
        kind: "habit",
        title: "10-minute walk after lunch",
        days_per_week: 3,
      },
    },
    {
      text: "Taxes are still open.",
      how: "Block 20 minutes.",
      suggestion: { kind: "task", title: "Gather tax receipts" },
    },
  ],
}

const view = (state: Parameters<typeof FernReviewView>[0]["state"]) =>
  render(<FernReviewView state={state} onRetry={jest.fn()} />, { wrapper })

describe("FernReviewView", () => {
  it("renders wins before gaps", () => {
    view({ state: "ready", review })
    const all = screen.getAllByText(/./).map((n) => n.props.children)
    const win = all.indexOf("You read on four days.")
    const gap = all.indexOf("Walks slipped after Tuesday.")
    expect(win).toBeGreaterThanOrEqual(0)
    expect(gap).toBeGreaterThan(win)
  })

  it("makes it a habit with a days-per-week schedule and confirms inline", () => {
    view({ state: "ready", review })
    fireEvent.press(screen.getByText("Make it a habit"))
    const h = habitsStore.get().habits.at(-1)
    expect(h?.name).toBe("10-minute walk after lunch")
    expect(h?.schedule).toEqual([{ days: [1, 3, 5] }])
    expect(screen.getByText("Added to habits ✓")).toBeTruthy()
    expect(toast).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("makes it a task", () => {
    view({ state: "ready", review })
    fireEvent.press(screen.getByText("Make it a task"))
    expect(tasksStore.get().tasks.at(-1)?.title).toBe("Gather tax receipts")
    expect(screen.getByText("Added to tasks ✓")).toBeTruthy()
  })

  it("dismiss hides the gap and remembers the title", () => {
    view({ state: "ready", review })
    fireEvent.press(screen.getAllByLabelText("Dismiss suggestion")[0])
    expect(screen.queryByText("Walks slipped after Tuesday.")).toBeNull()
    expect(dismissedTitles()).toEqual(["10-minute walk after lunch"])
  })

  it("wraps a long suggestion title", () => {
    view({
      state: "ready",
      review: {
        ...review,
        gaps: [
          {
            ...review.gaps[0],
            suggestion: { kind: "habit", title: LONG, days_per_week: 3 },
          },
        ],
      },
    })
    expect(screen.getByText(LONG).props.numberOfLines).toBeUndefined()
  })

  it("shows a skeleton while loading and Try again on error", () => {
    const loading = view({ state: "loading" })
    expect(screen.getByTestId("fern-review-loading")).toBeTruthy()
    loading.unmount()
    view({ state: "error", retrying: false })
    expect(screen.getByText("Try again")).toBeTruthy()
  })
})

describe("dismissals", () => {
  it("expire after 30 days", () => {
    dismissSuggestion("Stretch", new Date("2026-10-01T09:00:00"))
    dismissSuggestion("Journal", new Date("2026-11-01T09:00:00"))
    expect(dismissedTitles(new Date("2026-11-08T09:00:00"))).toEqual([
      "Journal",
    ])
  })
})

describe("daysForWeek", () => {
  it("spreads n days over the week", () => {
    expect(daysForWeek(1)).toEqual([1])
    expect(daysForWeek(2)).toEqual([1, 4])
    expect(daysForWeek(3)).toEqual([1, 3, 5])
    expect(daysForWeek(7)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(daysForWeek(null)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

describe("reviewRules", () => {
  it("lists wins from the data and plans the most-missed habit", () => {
    const out = reviewRules({
      kind: "way_back",
      days: [
        { day: "2026-11-01", onTarget: true },
        { day: "2026-11-02", onTarget: false },
      ],
      habits: [
        { name: "Read", done: 4, missed: 1, streak: 4 },
        { name: "Walk", done: 0, missed: 5, streak: 0 },
      ],
      tasksDone: 2,
      dismissed: [],
    })
    expect(out.source).toBe("rules")
    expect(out.wins.map((w) => w.text)).toEqual([
      "You hit your target on 1 of 2 days.",
      "Read: 4 days in a row.",
      "You finished 2 tasks.",
    ])
    expect(out.gaps[0].suggestion).toEqual({
      kind: "task",
      title: "Plan when to do Walk this week",
    })
    expect(out.gaps.length).toBeLessThanOrEqual(2)
  })
  it("still has a win with nothing logged", () => {
    const out = reviewRules({
      kind: "way_back",
      days: [],
      habits: [],
      tasksDone: 0,
      dismissed: [],
    })
    expect(out.wins.map((w) => w.text)).toEqual([
      "You came back. That's the step that counts.",
    ])
  })
})

describe("weekly review screen", () => {
  it("shows Ask Fern first and the review only after the tap", () => {
    const { Reviews } = require("../screens/dash-reviews")
    const monday = "2026-11-02"
    render(<Reviews id={`w-${monday}`} />, { wrapper })
    expect(screen.queryByTestId("fern-review")).toBeNull()
    fireEvent.press(screen.getByText("Ask Fern for a review"))
    expect(screen.getByTestId("fern-review")).toBeTruthy()
  })
})

describe("weeklyRange", () => {
  const { weeklyRange } = require("@domain/companion/review-rules")
  it("a past week is reviewed whole", () => {
    expect(weeklyRange("2026-10-26", "2026-11-01", "2026-11-08")).toEqual({
      fromDay: "2026-10-26",
      toDay: "2026-11-01",
    })
  })
  it("the current week runs through yesterday, so today's ticks keep the kept review", () => {
    expect(weeklyRange("2026-11-02", "2026-11-08", "2026-11-05")).toEqual({
      fromDay: "2026-11-02",
      toDay: "2026-11-04",
    })
  })
  it("has nothing to review on the week's first day", () => {
    expect(weeklyRange("2026-11-02", "2026-11-08", "2026-11-02")).toBeNull()
  })
})

describe("reviewHabits", () => {
  const { reviewHabits } = require("@domain/companion/review-rules")
  const h = (id: string, reason: string) => ({
    id,
    name: id,
    icon: "✅",
    type: "check" as const,
    schedule: [{ days: [0, 1, 2, 3, 4, 5, 6] }],
    reminder: false,
    status: "active" as const,
    pauses: [{ from: "2026-11-05", to: "2026-11-07", reason }],
    linkWorkout: false,
    createdAt: "2026-10-01",
    sortOrder: 0,
  })
  it("counts days a way-back pause covers as missed, other pauses not", () => {
    const rows = reviewHabits(
      [h("Walk", "way_back"), h("Swim", "holiday")],
      [],
      "2026-11-05",
      "2026-11-07",
      "2026-11-08",
    )
    expect(rows).toEqual([{ name: "Walk", done: 0, missed: 3, streak: 0 }])
  })
})
