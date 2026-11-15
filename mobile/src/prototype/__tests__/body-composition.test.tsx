// Body fat, lean mass, fat mass and waist on the Body weight page: the math
// that derives the masses, logging them from the weigh-in sheet, and the
// charts and summaries the page draws for them (dimmed samples until the
// first reading).

import * as FA from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import type { WeighIn } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import { dayKey, dayOffset } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { OverlayHost, resetOverlay } from "../overlay"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fitness/body",
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

const { Body, WeighInEditor } =
  require("../screens/fitness-body") as typeof import("../screens/fitness-body")

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
const hidden = { includeHiddenElements: true }
const morning = (offset: number) => `${dayOffset(offset)}T06:30:00`
const at = (offset: number) => new Date(morning(offset)).toISOString()

function seed(weighIns: WeighIn[]) {
  fitStore.set((s) => ({ ...s, weighIns }))
}

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  jest.clearAllMocks()
})

// ------------------------------------------------------------------ math

describe("body composition math", () => {
  it("splits weight into fat and lean mass by body fat", () => {
    const c = C.bodyComposition(80, 25)
    expect(c.fatKg).toBeCloseTo(20)
    expect(c.leanKg).toBeCloseTo(60)
  })

  it("derives lean and fat mass only for weigh-ins with body fat", () => {
    const w: WeighIn = {
      id: "a",
      measuredAt: at(0),
      weightKg: 63.6,
      bodyFatPct: 20,
    }
    expect(C.metricValue(w, "fatMass")).toBeCloseTo(12.72)
    expect(C.metricValue(w, "leanMass")).toBeCloseTo(50.88)
    expect(C.metricValue({ ...w, bodyFatPct: undefined }, "leanMass")).toBe(
      undefined,
    )
    expect(C.metricValue({ ...w, waistCm: 81 }, "waist")).toBe(81)
  })

  it("charts each day's first reading with a 7-day average", () => {
    const s = {
      ...fitStore.get(),
      weighIns: [
        { id: "1", measuredAt: at(-2), weightKg: 70, waistCm: 82 },
        { id: "2", measuredAt: at(-1), weightKg: 70 },
        { id: "3", measuredAt: at(0), weightKg: 70, waistCm: 80 },
      ],
    }
    const trend = C.metricTrend(s, "waist", 3)
    expect(trend.map((p) => p.raw)).toEqual([82, undefined, 80])
    expect(trend.map((p) => p.avg)).toEqual([82, 82, 81])
    expect(trend.at(-1)?.day).toBe(dayKey())
  })

  it("reports the latest reading and its change over the window", () => {
    const s = {
      ...fitStore.get(),
      weighIns: [
        { id: "old", measuredAt: at(-60), weightKg: 80, bodyFatPct: 30 },
        { id: "a", measuredAt: at(-20), weightKg: 80, bodyFatPct: 25 },
        { id: "b", measuredAt: at(0), weightKg: 78, bodyFatPct: 22.5 },
      ],
    }
    const fat = C.metricChange(s, "fatMass", 30)!
    expect(fat.latest).toBeCloseTo(17.55)
    expect(fat.delta).toBeCloseTo(17.55 - 20)
    const lean = C.metricChange(s, "leanMass", 30)!
    expect(lean.delta).toBeCloseTo(60.45 - 60)
    expect(C.metricChange(s, "waist", 30)).toBeUndefined()
  })
})

// --------------------------------------------------------------- logging

describe("weigh-in sheet", () => {
  it("logs body fat and waist, and shows the masses they make", () => {
    seed([{ id: "w", measuredAt: at(-1), weightKg: 80 }])
    const onClose = jest.fn()
    render(<WeighInEditor open onClose={onClose} />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Weight", hidden), "80")
    fireEvent.changeText(
      screen.getByLabelText("Body fat (optional)", hidden),
      "25",
    )
    expect(screen.getByTestId("weigh-derived", hidden)).toHaveTextContent(
      /Fat mass 20\.0 kg · Lean mass 60\.0 kg/,
    )
    // Waist starts empty; + starts it at a sensible reading, then steps.
    fireEvent.press(screen.getByLabelText("Raise waist", hidden))
    fireEvent.press(screen.getByLabelText("Raise waist", hidden))
    expect(screen.getByLabelText("Waist (optional)", hidden).props.value).toBe(
      "80.5",
    )
    fireEvent.press(screen.getByText("Log weigh-in", hidden))
    const logged = fitStore.get().weighIns.find((w) => w.id !== "w") as WeighIn
    expect(logged).toMatchObject({
      weightKg: 80,
      bodyFatPct: 25,
      waistCm: 80.5,
    })
    expect(onClose).toHaveBeenCalled()
  })

  it("keeps a typed decimal point while the number is entered", () => {
    seed([{ id: "w", measuredAt: at(-1), weightKg: 80 }])
    render(<WeighInEditor open onClose={() => {}} />, { wrapper })
    const waist = screen.getByLabelText("Waist (optional)", hidden)
    fireEvent.changeText(waist, "82.")
    expect(screen.getByLabelText("Waist (optional)", hidden).props.value).toBe(
      "82.",
    )
    fireEvent.changeText(waist, "82.5")
    fireEvent.press(screen.getByText("Log weigh-in", hidden))
    expect(fitStore.get().weighIns.at(-1)?.waistCm).toBe(82.5)
  })

  it("leaves body fat and waist out when they stay empty", () => {
    seed([{ id: "w", measuredAt: at(-1), weightKg: 80 }])
    render(<WeighInEditor open onClose={() => {}} />, { wrapper })
    fireEvent.press(screen.getByText("Log weigh-in", hidden))
    const w = fitStore.get().weighIns.at(-1)!
    expect(w.bodyFatPct).toBeUndefined()
    expect(w.waistCm).toBeUndefined()
  })

  it("clears a reading on edit when its field is emptied", () => {
    const entry: WeighIn = {
      id: "w",
      measuredAt: at(-1),
      weightKg: 80,
      bodyFatPct: 22,
      waistCm: 84,
    }
    seed([entry])
    render(<WeighInEditor entry={entry} open onClose={() => {}} />, {
      wrapper,
    })
    fireEvent.changeText(screen.getByLabelText("Waist (optional)", hidden), "")
    fireEvent.press(screen.getByText("Save changes", hidden))
    const w = fitStore.get().weighIns[0]
    expect(w.waistCm).toBeUndefined()
    expect(w.bodyFatPct).toBe(22)
  })

  it("passes body fat and waist through the capture action", () => {
    const w = FA.logWeighIn(70, at(0), undefined, 18.26, 79.94)
    expect(w).toMatchObject({ bodyFatPct: 18.3, waistCm: 79.9 })
  })
})

// --------------------------------------------------------------- the page

describe("Body weight page", () => {
  const full = (): WeighIn[] =>
    [-40, -20, -10, -3, 0].map((n, i) => ({
      id: `w${i}`,
      measuredAt: at(n),
      weightKg: 66 - i * 0.6,
      bodyFatPct: 22 - i * 0.5,
      waistCm: 84 - i,
    }))

  it("charts body fat, lean mass and fat mass, each with its latest value", () => {
    seed(full())
    render(<Body />, { wrapper })
    for (const k of ["bodyFat", "leanMass", "fatMass"])
      expect(screen.getByTestId(`comp-chart-${k}`)).toBeTruthy()
    expect(screen.getByLabelText("Body fat trend")).toBeTruthy()
    // Latest: 63.6 kg at 20% -> 12.7 kg fat, 50.9 kg lean.
    expect(screen.getByTestId("comp-bodyFat")).toHaveTextContent(/20\.0%/)
    expect(screen.getByTestId("comp-fatMass")).toHaveTextContent(/12\.7 kg/)
    expect(screen.getByTestId("comp-leanMass")).toHaveTextContent(/50\.9 kg/)
    // 30 days back the reading was 21.5%: down 1.5 points.
    expect(screen.getByTestId("comp-bodyFat")).toHaveTextContent(
      /▼ 1\.5 pts \/ 30d/,
    )
    expect(screen.queryByTestId("body-comp-empty")).toBeNull()
  })

  it("hides and shows a series from its toggle", () => {
    seed(full())
    render(<Body />, { wrapper })
    fireEvent.press(screen.getByLabelText("Lean mass chart"))
    expect(screen.queryByTestId("comp-chart-leanMass")).toBeNull()
    expect(screen.getByTestId("comp-chart-fatMass")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Lean mass chart"))
    expect(screen.getByTestId("comp-chart-leanMass")).toBeTruthy()
  })

  it("draws the waist chart with the latest and its change over the range", () => {
    seed(full())
    render(<Body />, { wrapper })
    expect(screen.getByLabelText("Waist trend")).toBeTruthy()
    expect(screen.getByTestId("waist-latest")).toHaveTextContent(/80\.0 cm/)
    // 12 weeks back the first reading was 84 cm.
    expect(screen.getByTestId("waist-change")).toHaveTextContent(/▼ 4\.0 cm/)
    expect(screen.queryByTestId("waist-empty")).toBeNull()
  })

  it("shows dimmed sample charts with a prompt for metrics never logged", () => {
    seed([
      { id: "a", measuredAt: at(-2), weightKg: 70 },
      { id: "b", measuredAt: at(0), weightKg: 69.8 },
    ])
    render(<Body />, { wrapper })
    expect(screen.getByTestId("body-comp-empty")).toHaveTextContent(
      /Add body fat when you weigh in/,
    )
    expect(screen.getByTestId("waist-empty")).toHaveTextContent(
      /Add your waist when you weigh in/,
    )
    // The real charts still draw, from samples, under the prompt.
    expect(screen.getByTestId("comp-chart-bodyFat", hidden)).toBeTruthy()
    expect(screen.getByLabelText("Waist trend", hidden)).toBeTruthy()
    expect(screen.queryByText(/no data/i, hidden)).toBeNull()
  })

  it("lists body fat and waist on each entry", () => {
    seed(full())
    render(<Body />, { wrapper })
    expect(
      screen.getAllByText(/20% fat · 80 cm waist/, hidden).length,
    ).toBeGreaterThan(0)
  })

  it("opens the weigh-in sheet from the waist prompt", () => {
    seed([{ id: "a", measuredAt: at(0), weightKg: 70 }])
    render(<Body />, { wrapper })
    act(() => {
      fireEvent.press(screen.getAllByText("Add", hidden).at(-1) as never)
    })
    expect(screen.getByLabelText("Waist (optional)", hidden)).toBeTruthy()
  })
})
