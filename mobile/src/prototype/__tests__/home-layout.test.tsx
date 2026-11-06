// Home's sections follow the person's saved order and Home-only hiding; a
// module or extra switched off stays hidden whatever the layout says; ids a
// release does not know survive, and new sections land at their default
// place; Reset puts Home back as shipped. Plus the edit screen.

import { MODULE_KEYS, orderModules } from "@domain/dash/data"
import { dashStore, moveModule, setEnabled } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Alert } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { setShown } from "../extras"
import {
  DEFAULT_ORDER,
  HOME_SECTIONS,
  homeLayoutStore,
  homeOrder,
  moduleOrderFrom,
  moveAmong,
  moveSection,
  resetHomeLayout,
  resolveOrder,
  setSectionShown,
  withModuleOrder,
} from "../home-layout"

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

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.restoreAllMocks()
})

describe("the order", () => {
  test("never edited: the default order, modules in their module order", () => {
    expect(homeLayoutStore.get()).toBeNull()
    expect(homeOrder(null, orderModules(undefined))).toEqual(DEFAULT_ORDER)
    // Every section id is unique and stored-safe.
    expect(new Set(DEFAULT_ORDER).size).toBe(DEFAULT_ORDER.length)
    for (const id of DEFAULT_ORDER) expect(id).toMatch(/^[a-z][a-z0-9_]{0,31}$/)
  })

  test("a saved order is kept as saved, duplicates dropped", () => {
    const saved = ["goals", "plan", "goals", ...DEFAULT_ORDER]
    const out = resolveOrder(saved)
    expect(out[0]).toBe("goals")
    expect(out[1]).toBe("plan")
    expect(out).toHaveLength(DEFAULT_ORDER.length)
  })

  test("a section this release added lands at its default place", () => {
    // Saved before "tomorrow" and "first_week" existed.
    const saved = DEFAULT_ORDER.filter(
      (x) => x !== "tomorrow" && x !== "first_week",
    ).reverse()
    const out = resolveOrder(saved)
    // Right after the section it follows by default.
    expect(out[out.indexOf("yesterday") + 1]).toBe("first_week")
    expect(out[out.indexOf("recap") + 1]).toBe("tomorrow")
    expect(out).toHaveLength(DEFAULT_ORDER.length)
    // A new first section goes first.
    expect(resolveOrder(["plan"], ["zeta", "plan"])).toEqual(["zeta", "plan"])
  })

  test("an id this release does not know is kept, in its place", () => {
    const out = resolveOrder(["future_card", "goals", ...DEFAULT_ORDER])
    expect(out.slice(0, 2)).toEqual(["future_card", "goals"])
    // And it survives a move made on this phone.
    homeLayoutStore.set({ order: out, hidden: ["future_card"] })
    moveSection("plan", 0, ["goals", "plan"])
    const saved = homeLayoutStore.get()
    expect(saved?.order.slice(0, 2)).toEqual(["future_card", "plan"])
    expect(saved?.order.indexOf("goals")).toBeGreaterThan(1)
    expect(saved?.hidden).toEqual(["future_card"])
  })

  test("a move among the listed rows leaves unlisted ids in their slots", () => {
    const ids = ["a", "x", "b", "y", "c"]
    expect(moveAmong(ids, ["a", "b", "c"], "c", 0)).toEqual([
      "c",
      "x",
      "a",
      "y",
      "b",
    ])
    expect(moveAmong(ids, ["a", "b", "c"], "a", 9)).toEqual([
      "b",
      "x",
      "c",
      "y",
      "a",
    ])
  })

  test("module cards keep one order with Settings → Sections", () => {
    const ids = ["plan", "habits", "goals", "tasks", "finance"]
    expect(withModuleOrder(ids, ["finance", "tasks", "habits"])).toEqual([
      "plan",
      "finance",
      "goals",
      "tasks",
      "habits",
    ])
    // Moving a card on Home moves its module; Screen time keeps its place.
    expect(
      moduleOrderFrom(["tasks", "goals", "habits"], [...MODULE_KEYS]),
    ).toEqual([
      "tasks",
      "habits",
      "fitness",
      "nutrition",
      "focus",
      "finance",
      "screen",
    ])
    moveSection("finance", 0, ["habits", "tasks", "finance"])
    expect(orderModules(dashStore.get().order)[0]).toBe("finance")
    // And Settings → Sections moves the Home card.
    moveModule("tasks", 0)
    const home = homeOrder(
      homeLayoutStore.get(),
      orderModules(dashStore.get().order),
    )
    expect(home.indexOf("tasks")).toBeLessThan(home.indexOf("finance"))
  })

  test("Reset puts back the default order, every section shown", () => {
    moveSection("goals", 0, [...DEFAULT_ORDER])
    setSectionShown("plan", false)
    moveModule("finance", 0)
    resetHomeLayout()
    expect(homeLayoutStore.get()).toEqual({
      order: DEFAULT_ORDER,
      hidden: [],
    })
    expect(orderModules(dashStore.get().order)).toEqual(MODULE_KEYS)
  })

  test("hiding then showing a section keeps its place", () => {
    moveSection("goals", 0, [...DEFAULT_ORDER])
    setSectionShown("goals", false)
    expect(homeLayoutStore.get()?.hidden).toEqual(["goals"])
    setSectionShown("goals", true)
    expect(homeLayoutStore.get()?.hidden).toEqual([])
    expect(homeLayoutStore.get()?.order[0]).toBe("goals")
  })
})

describe("Home", () => {
  // Where each text first appears in the rendered tree.
  type Node = { children?: (Node | string)[] | null } | string | null
  const texts = (n: Node | Node[], out: string[] = []): string[] => {
    if (!n) return out
    if (typeof n === "string") out.push(n)
    else if (Array.isArray(n)) for (const c of n) texts(c, out)
    else for (const c of n.children ?? []) texts(c, out)
    return out
  }
  const at = (text: string) =>
    texts(screen.toJSON() as Node | Node[]).indexOf(text)
  const renderToday = () => {
    jest.useFakeTimers({ now: new Date(`${dayKey()}T09:30:00`) })
    const { Today } = require("../screens/today")
    const view = render(<Today />, { wrapper })
    for (let i = 0; i < 40; i++) act(() => jest.advanceTimersByTime(50))
    return view
  }
  afterEach(() => jest.useRealTimers())

  test("renders the sections in the saved order: Goals in play on top", () => {
    renderToday()
    const goalsDefault = at("Goals in play")
    expect(goalsDefault).toBeGreaterThan(0)
    expect(at("Your apps")).toBeGreaterThan(-1)
    expect(at("Your apps")).toBeLessThan(goalsDefault)
    screen.unmount()
    moveSection("goals", 0, [...DEFAULT_ORDER])
    renderToday()
    expect(at("Goals in play")).toBeGreaterThan(0)
    expect(at("Goals in play")).toBeLessThan(at("Your apps"))
  })

  test("a section hidden on Home is not rendered", () => {
    renderToday()
    expect(screen.getByText("Goals in play")).toBeTruthy()
    screen.unmount()
    setSectionShown("goals", false)
    renderToday()
    expect(screen.queryByText("Goals in play")).toBeNull()
    // Home only: the rest still renders.
    expect(at("Your apps")).toBeGreaterThan(-1)
  })

  test("a module switched off stays off Home whatever the layout says", () => {
    const count = (text: string) =>
      texts(screen.toJSON() as Node | Node[]).filter((x) => x === text).length
    homeLayoutStore.set({ order: ["habits", ...DEFAULT_ORDER], hidden: [] })
    renderToday()
    const habitsOn = count("Habits")
    expect(screen.getByText("How's today?")).toBeTruthy()
    screen.unmount()
    setEnabled("habits", false)
    setShown("journal", false)
    renderToday()
    // The card's title goes (the launcher's tile goes with the module too).
    expect(count("Habits")).toBeLessThan(habitsOn)
    expect(screen.queryByText("How's today?")).toBeNull()
  })

  test("an unknown id draws nothing and breaks nothing", () => {
    homeLayoutStore.set({
      order: ["future_card", ...DEFAULT_ORDER],
      hidden: [],
    })
    renderToday()
    expect(screen.getByText("Goals in play")).toBeTruthy()
  })

  test("the pencil on the header opens the edit screen", () => {
    const { router } = require("expo-router")
    renderToday()
    fireEvent.press(screen.getByLabelText("Edit Home"))
    expect(router.push).toHaveBeenCalledWith("/today/edit")
  })
})

describe("the edit screen", () => {
  const { HomeLayoutEditor } =
    require("../screens/home-layout-editor") as typeof import("../screens/home-layout-editor")
  const rows = () =>
    screen
      .getAllByTestId(/^home-section-(?!off-)/)
      .map((n) => n.props.testID.replace("home-section-", ""))

  test("lists every section in Home's order, with a switch each", () => {
    render(<HomeLayoutEditor />, { wrapper })
    const native = HOME_SECTIONS.filter((x) => !x.web).map((x) => x.id)
    expect(rows()).toEqual(native)
    expect(
      screen.getByRole("switch", { name: "Show Goals in play on Home" }),
    ).toBeTruthy()
  })

  test("Move up on a grip moves the section; the switch hides it", () => {
    render(<HomeLayoutEditor />, { wrapper })
    const grip = screen.getByLabelText("Reorder Goals in play")
    for (let i = 0; i < DEFAULT_ORDER.length; i++)
      act(() =>
        grip.props.onAccessibilityAction({
          nativeEvent: { actionName: "decrement" },
        }),
      )
    expect(rows()[0]).toBe("goals")
    expect(homeLayoutStore.get()?.order[0]).toBe("goals")
    fireEvent.press(
      screen.getByRole("switch", { name: "Show Weather on Home" }),
    )
    expect(homeLayoutStore.get()?.hidden).toEqual(["weather"])
    expect(screen.getByText("Off Home")).toBeTruthy()
  })

  test("a section switched off in Settings is listed apart, not as a row", () => {
    setShown("weather", false)
    setEnabled("finance", false)
    render(<HomeLayoutEditor />, { wrapper })
    expect(rows()).not.toContain("weather")
    expect(rows()).not.toContain("finance")
    expect(screen.getByTestId("home-section-off-weather")).toBeTruthy()
    expect(screen.getByTestId("home-section-off-finance")).toBeTruthy()
  })

  test("Reset to default asks, then restores the default order", () => {
    moveSection("goals", 0, [...DEFAULT_ORDER])
    setSectionShown("plan", false)
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.())
    render(<HomeLayoutEditor />, { wrapper })
    fireEvent.press(screen.getByText("Reset to default"))
    expect(alert).toHaveBeenCalledWith(
      "Reset Home?",
      expect.any(String),
      expect.any(Array),
    )
    expect(homeLayoutStore.get()).toEqual({ order: DEFAULT_ORDER, hidden: [] })
    expect(rows()[0]).toBe("weekly_review")
  })
})
