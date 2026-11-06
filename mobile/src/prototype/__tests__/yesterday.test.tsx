// The Yesterday page: Fern's read first (skeleton while it loads, an error
// with Try again, a celebration when nothing slipped, asked once per
// session), then yesterday's misses only, each saying its kind and cost,
// opening its record on tap, with a reflection note.

import type { Miss } from "@domain/contract"
import { addDays } from "@domain/habits/logic"
import { dayKey } from "@domain/lib/day"
import { configureStorage } from "@domain/lib/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/today/yesterday",
  useFocusEffect: () => {},
}))
const mockLive = { on: true }
jest.mock("@/live/config", () => ({
  get liveMode() {
    return mockLive.on
  },
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockRequest = jest.fn()
jest.mock("@/live/auth", () => ({ http: { request: mockRequest } }))
const mockFeed: { misses: Miss[] } = { misses: [] }
jest.mock("@domain/dash/hooks", () => ({
  ...jest.requireActual("@domain/dash/hooks"),
  useAllMisses: () => mockFeed.misses,
  useOnTarget: () => ({
    series: [
      {
        day: require("@domain/habits/logic").addDays(
          require("@domain/lib/day").dayKey(),
          -1,
        ),
        due: 6,
        done: 3,
        onTarget: false,
      },
    ],
  }),
}))
const mockStorage = new Map<string, string>()
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: (k: string) => mockStorage.get(k) ?? null,
    setItem: (k: string, v: string) => mockStorage.set(k, v),
    removeItem: (k: string) => mockStorage.delete(k),
  }),
}))

const { Yesterday } =
  require("../screens/yesterday") as typeof import("../screens/yesterday")
const { missKind, missParts, missesOn, rulesRead } =
  require("../yesterday") as typeof import("../yesterday")
const { dashStore } =
  require("@domain/dash/store") as typeof import("@domain/dash/store")
const { router } = require("expo-router")

const yesterday = addDays(dayKey(), -1)
const habit: Miss = {
  id: `miss-h1-${yesterday}`,
  day: yesterday,
  title: "Missed: Read 20 pages",
  module: "habits",
  href: "/habits/h1",
}
const task: Miss = {
  id: "task-overdue:t1",
  day: yesterday,
  title: "Overdue 1d: File the quarterly taxes before the bank closes",
  module: "tasks",
  href: "/tasks/t1",
}
const earlier: Miss = {
  id: `miss-h1-${addDays(yesterday, -1)}`,
  day: addDays(yesterday, -1),
  title: "Missed: Read 20 pages",
  module: "habits",
  href: "/habits/h1",
}
const POINTS = [
  "Reading slipped two days running.",
  "Likely the late evenings: it sits last in the day.",
  "Read 10 pages before lunch today.",
]
const analysis = (over: object = {}) => ({
  day: yesterday,
  state: "analysis",
  source: "fern",
  points: POINTS,
  misses: 2,
  due: 6,
  done: 3,
  on_target: false,
  ...over,
})

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
let client: QueryClient
function Wrap({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  )
}
function show() {
  return render(<Yesterday />, { wrapper: Wrap })
}

beforeAll(() =>
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
)
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  mockRequest.mockReset()
  mockLive.on = true
  mockFeed.misses = [habit, task, earlier]
  dashStore.set((s) => ({ ...s, missNotes: {} }))
  ;(router.push as jest.Mock).mockClear()
})

describe("Fern's read", () => {
  it("shows a skeleton while Fern reads, then the three points", async () => {
    let answer: (v: unknown) => void = () => {}
    mockRequest.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    show()
    expect(screen.getByTestId("fern-read-loading")).toBeTruthy()
    // The list does not wait for Fern.
    expect(screen.getAllByTestId("yesterday-miss")).toHaveLength(2)
    await act(async () => answer(analysis()))
    await screen.findByText(POINTS[0])
    for (const p of POINTS) expect(screen.getByText(p)).toBeTruthy()
    expect(screen.queryByTestId("fern-read-loading")).toBeNull()
    expect(mockRequest).toHaveBeenCalledWith(
      "POST",
      "/dashboard/misses/yesterday/analysis",
      undefined,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it("asks once: reopening the page uses the answer it has", async () => {
    mockRequest.mockResolvedValue(analysis())
    client = new QueryClient({
      defaultOptions: { queries: { gcTime: 60_000 } },
    })
    const first = show()
    await screen.findByText(POINTS[0])
    first.unmount()
    show()
    expect(screen.getByText(POINTS[0])).toBeTruthy()
    expect(mockRequest).toHaveBeenCalledTimes(1)
  })

  it("a failure shows the error, and Try again asks again", async () => {
    mockRequest.mockRejectedValueOnce(new Error("503"))
    show()
    await screen.findByTestId("fern-read-error")
    expect(screen.getByText("Fern couldn’t read yesterday")).toBeTruthy()
    // The misses are still all there.
    expect(screen.getAllByTestId("yesterday-miss")).toHaveLength(2)
    mockRequest.mockResolvedValueOnce(analysis())
    fireEvent.press(screen.getByText("Try again"))
    await screen.findByText(POINTS[2])
    expect(screen.queryByTestId("fern-read-error")).toBeNull()
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it("celebrates a day with nothing missed", async () => {
    mockFeed.misses = [earlier]
    mockRequest.mockResolvedValueOnce(
      analysis({ state: "celebrate", source: "none", points: [], misses: 0 }),
    )
    show()
    await screen.findByTestId("fern-read-celebrate")
    expect(
      screen.getAllByText("Nothing slipped yesterday").length,
    ).toBeGreaterThan(0)
    // The list shows dimmed sample rows behind its message, not a blank.
    expect(screen.getByText("See all misses")).toBeTruthy()
  })

  it("says when the read comes from the data because AI is off", async () => {
    mockRequest.mockResolvedValueOnce(
      analysis({ source: "rules", points: ["a.", "b.", "c."] }),
    )
    show()
    await screen.findByText("AI is off, so this is a quick read of your data.")
  })

  it("prototype mode reads the data on the phone, no server call", () => {
    mockLive.on = false
    show()
    expect(
      screen.getByText("2 things slipped yesterday, 1 of them in habits."),
    ).toBeTruthy()
    expect(
      screen.getByText("Today, do Read 20 pages first, before anything else."),
    ).toBeTruthy()
    expect(mockRequest).not.toHaveBeenCalled()
  })
})

describe("the list", () => {
  it("lists yesterday's misses only, each with its kind and cost", () => {
    mockRequest.mockReturnValue(new Promise(() => {}))
    show()
    const rows = screen.getAllByTestId("yesterday-miss")
    expect(rows).toHaveLength(2)
    expect(screen.getByText("Missed habit")).toBeTruthy()
    expect(screen.getByText("Overdue task")).toBeTruthy()
    // The whole title, never cut.
    expect(
      screen.getByText("File the quarterly taxes before the bank closes"),
    ).toBeTruthy()
    expect(screen.getByText("overdue 1d")).toBeTruthy()
    expect(screen.getByText("3 of 6 done · off target · 2 misses")).toBeTruthy()
  })

  it("a row opens its record", () => {
    mockRequest.mockReturnValue(new Promise(() => {}))
    show()
    fireEvent.press(screen.getByLabelText(/^Overdue task: File the quarterly/))
    expect(router.push).toHaveBeenCalledWith("/tasks/t1")
  })

  it("saves a reflection note on a miss", () => {
    mockRequest.mockReturnValue(new Promise(() => {}))
    show()
    fireEvent.press(screen.getByLabelText("Add a note on Read 20 pages"))
    fireEvent.press(screen.getByLabelText("Work ran late"))
    fireEvent.press(screen.getByText("Save note"))
    expect(dashStore.get().missNotes[habit.id]).toBe("Work ran late")
    expect(screen.getByText("“Work ran late”")).toBeTruthy()
    expect(screen.getByLabelText("Edit note on Read 20 pages")).toBeTruthy()
  })
})

describe("helpers", () => {
  it("names every kind the feed emits", () => {
    expect(missKind("miss-x-2026-11-05").word).toBe("Missed habit")
    expect(missKind("task-overdue:x").word).toBe("Overdue task")
    expect(missKind("fin-budget-x-2026-11").word).toBe("Over budget")
    expect(missKind("nut-over-2026-11-05").word).toBe("Over calories")
    expect(missKind("focus-under-2026-11-05").word).toBe("Focus short")
    expect(missKind("something-new").word).toBe("Missed")
  })

  it("says each miss's cost", () => {
    const p = (title: string, module: Miss["module"] = "finance") =>
      missParts({ title, module })
    expect(p("Over Food budget by 12% (Nov)")).toEqual({
      name: "Food budget",
      cost: "over by 12% in Nov",
    })
    expect(p("Over calories by 9%", "nutrition")).toEqual({
      name: "Calories",
      cost: "over the target by 9%",
    })
    expect(p("Focused 1h 10m of 2h", "focus")).toEqual({
      name: "Focus goal",
      cost: "1h 10m of 2h focused",
    })
    expect(p("Missed: Walk", "habits")).toEqual({
      name: "Walk",
      cost: "missed",
    })
  })

  it("keeps one day only", () => {
    expect(missesOn([habit, earlier], yesterday)).toEqual([habit])
  })

  it("the rules read names a pattern, or quotes a note", () => {
    expect(rulesRead([], [], {})).toEqual([])
    const week = [earlier, { ...earlier, day: addDays(yesterday, -2) }]
    expect(rulesRead([habit], week, {})).toEqual([
      "1 thing slipped yesterday, all in habits.",
      "Read 20 pages slipped 3 of the last 7 days, so it is a pattern, not a one-off.",
      "Today, do Read 20 pages first, before anything else.",
    ])
    expect(rulesRead([habit, task], [], { [task.id]: "Sick" })[1]).toBe(
      "You noted “Sick” on File the quarterly taxes before the bank closes.",
    )
  })
})
