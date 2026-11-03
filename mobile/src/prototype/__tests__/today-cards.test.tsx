// The Today cards drawn after the card library: the weather drawing for
// each sky, the first week as leaves, steps against the goal, fiber beside
// the macros, the limits on one bar with the mark at the limit, the focus
// week, and goals as vines with the cost of each miss.
import * as A from "@domain/focus/actions"
import { DEFAULT_SETTINGS } from "@domain/focus/data"
import { focusStore } from "@domain/focus/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import { Text } from "react-native"

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
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { skyImage, skyImageIsDark } =
  require("../weather") as typeof import("../weather")
const { SkyCard } =
  require("../weather-card") as typeof import("../weather-card")
const { FirstWeekView, LeafRow } =
  require("../daily-strips") as typeof import("../daily-strips")
const { StepsTodayView } =
  require("../screens/steps-card") as typeof import("../screens/steps-card")
const { MacroRings, ringLayout } =
  require("../screens/nutrition") as typeof import("../screens/nutrition")
const { LimitBar, scaleTop } =
  require("../screens/nutrient-limits") as typeof import("../screens/nutrient-limits")
const { focusWeek } =
  require("../screens/today-stats") as typeof import("../screens/today-stats")
const { GoalVine, goalLeft, missCost } =
  require("../goal-vine") as typeof import("../goal-vine")
const { TrophyBadge } =
  require("../brand/badge") as typeof import("../brand/badge")
const { CornerMotif } =
  require("../brand/corner") as typeof import("../brand/corner")

describe("weather drawing per sky", () => {
  it("clear and partly skies have a day and a night drawing; the rest one", () => {
    expect(skyImage("clear", true)).toBe("clear-day")
    expect(skyImage("clear", false)).toBe("clear-night")
    expect(skyImage("partly", true)).toBe("partly-day")
    expect(skyImage("partly", false)).toBe("partly-night")
    for (const sky of [
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "snow",
      "storm",
    ] as const) {
      expect(skyImage(sky, true)).toBe(sky)
      expect(skyImage(sky, false)).toBe(sky)
    }
  })
  it("only the night drawings take light text", () => {
    expect(skyImageIsDark("clear-night")).toBe(true)
    expect(skyImageIsDark("partly-night")).toBe(true)
    expect(skyImageIsDark("clear-day")).toBe(false)
    expect(skyImageIsDark("storm")).toBe(false)
  })
  it("the card draws on its sky's art, with ink by day and light text by night", () => {
    const seen: string[] = []
    const { rerender } = render(
      <SkyCard sky="storm">
        {(ink) => {
          seen.push(ink.text)
          return <Text>27°</Text>
        }}
      </SkyCard>,
    )
    expect(screen.getByTestId("sky-card-storm")).toBeTruthy()
    rerender(
      <SkyCard sky="clear-night">
        {(ink) => {
          seen.push(ink.text)
          return <Text>26°</Text>
        }}
      </SkyCard>,
    )
    expect(screen.getByTestId("sky-card-clear-night")).toBeTruthy()
    expect(seen[0]).toBe("#1b1f1c")
    expect(seen.at(-1)).toBe("#ecebe6")
  })
})

describe("your first week as leaves", () => {
  const week = (lit: number, todayAt: number) =>
    Array.from({ length: 7 }, (_, i) => ({
      day: `2026-11-0${i + 1}`,
      logged: i < lit,
    })).map((d, i) => ({ ...d, today: i === todayAt }))
  it("empty: nothing before the first log", () => {
    render(<FirstWeekView week={[]} today="2026-11-01" />)
    expect(screen.queryByTestId("first-week")).toBeNull()
  })
  it("day 2, one lit: a filled leaf, today outlined, five faint ahead", () => {
    const w = week(1, 1)
    render(<FirstWeekView week={w} today="2026-11-02" />)
    expect(screen.getByText("Day 2 of 7 · 1 lit")).toBeTruthy()
    expect(screen.getAllByTestId("leaf-lit")).toHaveLength(1)
    expect(screen.getAllByTestId("leaf-today")).toHaveLength(1)
    expect(screen.getAllByTestId("leaf-ahead")).toHaveLength(5)
    expect(screen.getByLabelText("1 of 7 days lit")).toBeTruthy()
    expect(
      screen.getByTestId("corner-motif", { includeHiddenElements: true }),
    ).toBeTruthy()
  })
  it("a full week: seven filled leaves and the win said", () => {
    render(<FirstWeekView week={week(7, 6)} today="2026-11-07" />)
    expect(screen.getAllByTestId("leaf-lit")).toHaveLength(7)
    expect(screen.getByText("Your first week is complete.")).toBeTruthy()
  })
  it("a leaf row with nothing lit is all faint", () => {
    render(<LeafRow cells={Array(7).fill("ahead")} />)
    expect(screen.getAllByTestId("leaf-ahead")).toHaveLength(7)
  })
})

describe("steps today", () => {
  it("empty: 0 of 10,000 and 0 kcal burned", () => {
    render(<StepsTodayView steps={0} kcal={0} />)
    expect(screen.getAllByText("0")).toHaveLength(2)
    expect(screen.getByText("/ 10,000 steps today")).toBeTruthy()
    expect(
      screen.getByLabelText("0 of 10,000 steps today, 0 kcal burned"),
    ).toBeTruthy()
  })
  it("loaded past the goal: separators, and the goal said", () => {
    render(<StepsTodayView steps={12480} kcal={2860} />)
    expect(screen.getByText("12,480")).toBeTruthy()
    expect(screen.getByText("2,860")).toBeTruthy()
    expect(
      screen.getByLabelText(
        "12,480 of 10,000 steps today, goal reached, 2,860 kcal burned",
      ),
    ).toBeTruthy()
  })
})

describe("fiber ring", () => {
  const totals = { kcal: 640, protein: 41, carbs: 70, fat: 20 }
  const target = { kcal: 2200, protein: 140, carbs: 250, fat: 70 }
  it("empty: fiber at 0 of its goal", () => {
    render(
      <MacroRings
        totals={{ kcal: 0, protein: 0, carbs: 0, fat: 0 }}
        target={target}
        fiber={{ value: 0, goal: 30 }}
      />,
    )
    expect(screen.getByLabelText("Fiber: 0 of 30 g")).toBeTruthy()
    expect(screen.getByText("30 g left")).toBeTruthy()
  })
  it("loaded: fiber beside protein, carbs and fat", () => {
    render(
      <MacroRings
        totals={totals}
        target={target}
        fiber={{ value: 31, goal: 30 }}
      />,
    )
    expect(screen.getByTestId("fiber-ring")).toBeTruthy()
    expect(screen.getByText("goal met")).toBeTruthy()
  })
  it("four small rings fit beside the calorie ring on a 375 pt phone", () => {
    const w = 311,
      l = ringLayout(w, 4)
    expect(l.stacked).toBe(false)
    expect(l.big + 16 + 4 * l.small + 3 * 8).toBeLessThanOrEqual(w)
  })
})

describe("stay under: one bar, the mark at the limit", () => {
  it("the scale runs a quarter past the limit, or to the amount past that", () => {
    expect(scaleTop(6, 20)).toBe(25)
    expect(scaleTop(34, 25)).toBe(34)
    expect(scaleTop(0, 0)).toBeGreaterThan(0)
  })
  it("empty: not tracked yet", () => {
    render(<LimitBar k="sugar" amount={undefined} max={25} />)
    expect(screen.getByText("not tracked yet · under 25 g")).toBeTruthy()
  })
  it("over: says by how much", () => {
    render(<LimitBar k="sodium" amount={2840} max={2300} />)
    expect(screen.getByText("2,840 / 2,300 mg · 540 mg over")).toBeTruthy()
  })
})

describe("the focus week", () => {
  const T0 = new Date(2026, 9, 20, 9, 0, 0).getTime()
  beforeEach(() => {
    jest.useFakeTimers({ now: T0 })
    configureStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    })
    resetAll()
    focusStore.set({
      sessions: [],
      segments: [],
      settings: { ...DEFAULT_SETTINGS, dailyGoalMin: 60 },
      settingsSaved: true,
    })
  })
  afterEach(() => jest.useRealTimers())
  it("empty: no days on goal, no streak, no average", () => {
    const w = focusWeek(focusStore.get(), dayKey(), undefined, T0)
    expect(w).toMatchObject({
      onGoal: 0,
      target: 7,
      streak: 0,
      avg: 0,
      goal: 3600,
    })
    expect(w.bars).toEqual([0, 0, 0, 0, 0, 0, 0])
  })
  it("loaded: a 90-minute set today is one day on goal and a 1-day streak", () => {
    A.startFocus({ preset: "90-20" })
    jest.setSystemTime(T0 + 95 * 60_000)
    A.tickFocus()
    const w = focusWeek(focusStore.get(), dayKey(), 5, T0 + 95 * 60_000)
    expect(w.bars[6]).toBe(5400)
    expect(w).toMatchObject({ onGoal: 1, target: 5, streak: 1, avg: 5400 })
  })
})

describe("goals as vines", () => {
  const goal = {
    id: "g1",
    metric: "fitness:workouts",
    label: "Workouts",
    target: 4,
    unit: "",
    comparator: "gte" as const,
    period: "week" as const,
    status: "active" as const,
    createdAt: "2026-11-01",
  }
  it("a goal short of its target: a closed bud and what is left", () => {
    render(<GoalVine pct={0.25} hit={false} color="#000" seed={3} />)
    expect(screen.getByTestId("goal-bud")).toBeTruthy()
    expect(screen.queryByTestId("goal-bud-open")).toBeNull()
    expect(goalLeft(goal, 1, false)).toBe("3 to go this week")
  })
  it("a goal hit: the bud opens", () => {
    render(<GoalVine pct={1} hit color="#000" seed={3} />)
    expect(screen.getByTestId("goal-bud-open")).toBeTruthy()
    expect(goalLeft(goal, 4, true)).toBe("Hit this week")
  })
  it("no value yet: no line under the vine", () => {
    render(<GoalVine pct={0} hit={false} color="#000" seed={3} />)
    expect(screen.getByTestId("goal-vine")).toBeTruthy()
    expect(goalLeft(goal, null, false)).toBeNull()
  })
  it("a percentage goal counts points; a cap says how far over", () => {
    expect(goalLeft({ ...goal, unit: "%", target: 20 }, 17, false)).toBe(
      "3 pts to go this week",
    )
    expect(
      goalLeft(
        { ...goal, unit: "h", target: 2, comparator: "lte" },
        3.5,
        false,
      ),
    ).toBe("1.5 h over this week")
  })
})

describe("what each miss cost", () => {
  it("a habit miss names the run it ended", () => {
    expect(
      missCost({ title: "Missed: Evening walk", module: "habits" }, 6),
    ).toEqual({
      name: "Evening walk",
      cost: "missed · the 6-day run ended at 6",
    })
    expect(
      missCost({ title: "Missed: Evening walk", module: "habits" }),
    ).toEqual({ name: "Evening walk", cost: "missed" })
  })
  it("a task miss keeps its own cost", () => {
    expect(
      missCost({ title: "Overdue 2d: Send the invoice", module: "tasks" }),
    ).toEqual({ name: "Send the invoice", cost: "overdue 2d" })
  })
  it("anything else reads as its title", () => {
    expect(
      missCost({ title: "Over calories by 13%", module: "nutrition" }),
    ).toEqual({ name: "Over calories by 13%", cost: "missed" })
  })
})

describe("brand marks", () => {
  it("each trophy type has its badge", () => {
    for (const type of ["pr", "streak", "best", "goal", "first"] as const) {
      render(<TrophyBadge type={type} color="#b26a1a" />)
      expect(screen.getByTestId(`trophy-badge-${type}`)).toBeTruthy()
    }
  })
  it("the corner motif draws both kinds", () => {
    for (const kind of ["vine", "sprig"] as const) {
      render(<CornerMotif kind={kind} />)
      expect(
        screen.getByTestId("corner-motif", { includeHiddenElements: true }),
      ).toBeTruthy()
    }
  })
})
