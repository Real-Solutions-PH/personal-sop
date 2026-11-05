// The Finance home's "Next 7 days": the window is today through seven days
// ahead in the person's business day (their zone, rolling over at 04:00),
// never the UTC calendar; overdue bills lead; paused, ended, skipped and
// what-if items stay off. Every expected day below is read off a calendar
// for November 2026 (Fri 6 Nov is "today"), not computed with the code.
process.env.TZ = "Asia/Manila"

import { countdown, upcomingWeek } from "@domain/finance/calc"
import type { FinState, PlannedItem, Schedule } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { syncReady } from "@/live/ready"

const mockGo = jest.fn()
jest.mock("../navigation", () => ({
  ...jest.requireActual("../navigation"),
  go: (href: string) => mockGo(href),
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
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
  useAnimatedProps: (get: () => unknown) => get(),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))

const { UpcomingWeek } =
  require("../screens/finance-upcoming") as typeof import("../screens/finance-upcoming")

/** 10:00 on Fri 6 Nov 2026 in Manila. */
const NOW = new Date("2026-11-06T10:00:00+08:00")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] })
  syncReady.setState({ ready: true, failed: false })
  mockGo.mockClear()
})
afterEach(() => jest.useRealTimers())

const item = (
  id: string,
  schedule: Schedule,
  extra: Partial<PlannedItem> = {},
): PlannedItem => ({
  id,
  name: id,
  type: "expense",
  amount: 1000,
  estimated: false,
  accountId: "wallet",
  schedule,
  start: schedule.kind === "once" ? schedule.date : "2026-01-01",
  end: { kind: "never" },
  autoLog: false,
  isWhatIf: false,
  inProjection: true,
  archived: false,
  skipped: [],
  snoozed: {},
  ...extra,
})
const on = (id: string, date: string, extra: Partial<PlannedItem> = {}) =>
  item(id, { kind: "once", date }, extra)

function state(planned: PlannedItem[], records: FinState["records"] = []) {
  const s = finStore.get()
  const next: FinState = {
    ...s,
    records,
    accounts: [
      {
        ...s.accounts[0],
        id: "wallet",
        name: "GCash",
        archived: false,
      },
    ],
    planned,
  }
  finStore.set(next)
  return next
}
const ids = (s: FinState) => {
  const w = upcomingWeek(s)
  return {
    overdue: w.overdue.map((o) => o.item.id),
    days: w.days.map((d) => [d.day, d.items.map((o) => o.item.id)]),
  }
}

describe("the window", () => {
  test("today is in, yesterday is overdue, day 7 is in and day 8 is out", () => {
    const s = state([
      on("yesterday", "2026-11-05"),
      on("today", "2026-11-06"),
      on("day 7", "2026-11-13"),
      on("day 8", "2026-11-14"),
    ])
    expect(ids(s)).toEqual({
      overdue: ["yesterday"],
      days: [
        ["2026-11-06", ["today"]],
        ["2026-11-13", ["day 7"]],
      ],
    })
  })

  test("before 04:00 it is still yesterday's business day", () => {
    // 03:30 Fri 6 Nov: the day is Thu 5 Nov, so Friday's bill is tomorrow
    // and Thursday's is today, not late.
    jest.setSystemTime(new Date("2026-11-06T03:30:00+08:00"))
    const s = state([on("thu", "2026-11-05"), on("fri", "2026-11-06")])
    expect(ids(s)).toEqual({
      overdue: [],
      days: [
        ["2026-11-05", ["thu"]],
        ["2026-11-06", ["fri"]],
      ],
    })
    expect(countdown("2026-11-06").label).toBe("Due tomorrow")
  })

  test("the local day, not the UTC calendar, sets the window", () => {
    // 04:30 Fri 6 Nov in Manila is 20:30 Thu 5 Nov in UTC. A UTC window
    // would call Thursday's bill today and stop at Thu 12 Nov.
    jest.setSystemTime(new Date("2026-11-05T20:30:00Z"))
    const s = state([on("thu", "2026-11-05"), on("next fri", "2026-11-13")])
    expect(ids(s)).toEqual({
      overdue: ["thu"],
      days: [["2026-11-13", ["next fri"]]],
    })
  })

  test("every 3 months lands only on its own months", () => {
    const s = state([
      // 10 Aug, 10 Nov, 10 Feb: Tue 10 Nov is in the window.
      item(
        "quarterly from Aug",
        { kind: "monthly", day: 10, every: 3 },
        {
          start: "2026-08-10",
        },
      ),
      // 10 Sep, 10 Dec: nothing this week.
      item(
        "quarterly from Sep",
        { kind: "monthly", day: 10, every: 3 },
        {
          start: "2026-09-10",
        },
      ),
    ])
    expect(ids(s).days).toEqual([["2026-11-10", ["quarterly from Aug"]]])
  })

  test("paused, ended, skipped and what-if items stay off", () => {
    const weekly: Schedule = { kind: "weekly", anchor: "2026-10-02", every: 1 }
    const s = state([
      on("paused", "2026-11-07", { archived: true }),
      on("draft", "2026-11-07", { isWhatIf: true }),
      on("skipped", "2026-11-07", { skipped: ["2026-11-07"] }),
      // Fridays to Sun 8 Nov: Fri 6 Nov yes, Fri 13 Nov no.
      item("ends Sunday", weekly, {
        start: "2026-10-02",
        end: { kind: "date", date: "2026-11-08" },
      }),
      // Three Fridays from 23 Oct: 23 Oct, 30 Oct, 6 Nov, then done.
      item("three times", weekly, {
        start: "2026-10-23",
        end: { kind: "count", n: 3 },
      }),
    ])
    // Fri 23 and 30 Oct went unpaid, so both weekly items are overdue for
    // them; this week each falls once, on Fri 6 Nov, and never on the 13th.
    expect(ids(s)).toEqual({
      overdue: ["ends Sunday", "three times", "ends Sunday", "three times"],
      days: [["2026-11-06", ["ends Sunday", "three times"]]],
    })
  })

  test("the total due counts unpaid bills, overdue included; income apart", () => {
    const s = state(
      [
        on("late", "2026-11-04", { amount: 1500 }),
        on("rent", "2026-11-08", { amount: 18000 }),
        on("paid", "2026-11-07", { amount: 999 }),
        on("salary", "2026-11-10", { amount: 40000, type: "income" }),
      ],
      [
        {
          id: "r1",
          type: "expense",
          amount: 999,
          accountId: "wallet",
          at: "2026-11-06T09:00:00+08:00",
          source: "planned",
          plannedId: "paid",
          plannedOn: "2026-11-07",
          status: "cleared",
        },
      ],
    )
    const w = upcomingWeek(s)
    expect([w.dueTotal, w.incomeTotal, w.count]).toEqual([19500, 40000, 4])
    expect(w.days[0].items[0].status).toBe("paid")
    expect(w.days[1].items.map((o) => o.item.id)).toEqual(["rent"])
  })
})

describe("the countdown", () => {
  test("changes state as the day comes near", () => {
    expect(countdown("2026-11-03")).toEqual({
      state: "overdue",
      label: "3 days late",
    })
    // 10:00 to the 04:00 rollover is 18 hours.
    expect(countdown("2026-11-06")).toEqual({
      state: "today",
      label: "Due today · 18 h left",
    })
    expect(countdown("2026-11-07").state).toBe("soon")
    expect(countdown("2026-11-08")).toEqual({
      state: "soon",
      label: "In 2 days",
    })
    expect(countdown("2026-11-13")).toEqual({
      state: "later",
      label: "In 7 days",
    })
    // 03:30 on the next morning: half an hour of the business day left.
    expect(
      countdown("2026-11-06", new Date("2026-11-07T03:30:00+08:00")),
    ).toEqual({
      state: "today",
      label: "Due now",
    })
  })
})

describe("the section", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      {children}
    </SafeAreaProvider>
  )

  test("overdue first, in red words, then by day; a row opens its item", () => {
    state([
      on("Internet", "2026-11-04", { amount: 1699 }),
      on("Rent", "2026-11-07", { amount: 18000 }),
    ])
    render(<UpcomingWeek />, { wrapper })
    expect(screen.getByText("Overdue")).toBeTruthy()
    expect(screen.getByText("2 days late")).toBeTruthy()
    expect(screen.getByText("Tomorrow")).toBeTruthy()
    expect(screen.getByText("Due tomorrow")).toBeTruthy()
    expect(screen.getByText("−₱18,000")).toBeTruthy()
    expect(screen.getByText("₱19,699 due")).toBeTruthy()
    expect(screen.getAllByText("GCash")).toHaveLength(2)
    fireEvent.press(screen.getByRole("button", { name: /^Rent,/ }))
    expect(mockGo).toHaveBeenCalledWith("/finance/planned/Rent")
  })

  test("on one day, what is still to pay comes before what is paid", () => {
    const s = state(
      [on("Paid first", "2026-11-07"), on("Still due", "2026-11-07")],
      [
        {
          id: "r1",
          type: "expense",
          amount: 1000,
          accountId: "wallet",
          at: "2026-11-06T09:00:00+08:00",
          source: "planned",
          plannedId: "Paid first",
          plannedOn: "2026-11-07",
          status: "cleared",
        },
      ],
    )
    expect(upcomingWeek(s).days[0].items.map((o) => o.item.id)).toEqual([
      "Still due",
      "Paid first",
    ])
  })

  test("more than five rows fold behind Show N more", () => {
    state(
      Array.from({ length: 12 }, (_, i) =>
        on(`Bill ${i + 1}`, `2026-11-${String(6 + (i % 8)).padStart(2, "0")}`),
      ),
    )
    render(<UpcomingWeek />, { wrapper })
    expect(screen.queryByText("Bill 12")).toBeNull()
    fireEvent.press(screen.getByRole("button", { name: "Show 7 more" }))
    expect(screen.getByText("Bill 12")).toBeTruthy()
  })

  test("none due: the dimmed rows with when the next one is", () => {
    state([on("Insurance", "2026-12-01")])
    render(<UpcomingWeek />, { wrapper })
    expect(screen.getByTestId("upcoming-week-empty")).toBeTruthy()
    expect(
      screen.getByText(/Nothing due this week\. Next: Insurance/),
    ).toBeTruthy()
  })

  test("loading, failed and empty are three different screens", () => {
    state([])
    syncReady.setState({ ready: false, failed: false })
    const r = render(<UpcomingWeek />, { wrapper })
    expect(screen.getByTestId("upcoming-week-loading")).toBeTruthy()
    act(() => syncReady.setState({ ready: true, failed: true }))
    r.rerender(<UpcomingWeek />)
    expect(
      screen.getByText("Couldn’t load your scheduled payments"),
    ).toBeTruthy()
    act(() => syncReady.setState({ ready: true, failed: false }))
    r.rerender(<UpcomingWeek />)
    expect(screen.getByTestId("upcoming-week-empty")).toBeTruthy()
  })
})
