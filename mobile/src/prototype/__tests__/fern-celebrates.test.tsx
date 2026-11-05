// Fern celebrates every achievement (Kai: "fern should always celebrate on
// all achievements of the user"). Every finish page and moment goes
// through one of the surfaces below, and each draws FernCelebrates; under
// Reduce Motion Fern keeps celebrating (calmly, never a still pose); a miss
// consoles. The
// source scan at the end keeps it that way: a file that fires the success
// haptic (every completion does) must show Fern celebrating, or say here
// why it is not an achievement surface.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { OverlayHost, resetOverlay } from "../overlay"

const mockMotion = { reduced: false }
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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => mockMotion.reduced,
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
  NotificationFeedbackType: { Success: "success" },
  ImpactFeedbackStyle: { Light: "light" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))

const { Celebration } =
  require("../celebration") as typeof import("../celebration")
const { MomentCard } = require("../moment") as typeof import("../moment")
const { BigMoment } = require("../big-moment") as typeof import("../big-moment")
const { FlashLine } =
  require("../body-moments") as typeof import("../body-moments")
const { FernSprite } =
  require("../companion/fern-sprite") as typeof import("../companion/fern-sprite")

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

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  resetOverlay()
  mockMotion.reduced = false
})

const sprite = () =>
  screen.UNSAFE_getByType(FernSprite).props as {
    state: string
    still?: boolean
  }

const SURFACES: [string, () => React.ReactElement][] = [
  [
    "a finish page (workout, run, walk, routine)",
    () => (
      <Celebration
        kind="workout"
        title="Pull main complete"
        subtitle="Today"
        stats={[]}
        play
      />
    ),
  ],
  [
    "a moment card (trophy, focus, budget, goal weight, day, workout done)",
    () => (
      <MomentCard
        kind="trophy"
        label="Trophy earned"
        title="First 5k"
        detail={<Text>Today</Text>}
        badge={<Text>🏆</Text>}
        tint="#0a0"
        say="Trophy earned"
        hint="Opens it"
        onOpen={() => {}}
        testID="moment"
      />
    ),
  ],
  [
    "a big moment (level up, savings goal reached)",
    () => (
      <BigMoment
        label="Level up"
        title="Level 4"
        detail={<Text>Keep going</Text>}
        badge={<Text>⭐</Text>}
        tint="#0a0"
        say="Level up"
        onClose={() => {}}
        testID="big"
      />
    ),
  ],
  [
    "a goal-met line (meal on target, fiber goal hit)",
    () => <FlashLine text="Fiber goal hit" tone="good" />,
  ],
]

describe.each(SURFACES)("%s", (_name, surface) => {
  test("Fern celebrates", () => {
    render(surface(), { wrapper })
    expect(
      screen.getByTestId("fern-celebrates", { includeHiddenElements: true }),
    ).toBeTruthy()
    expect(sprite().state).toBe("celebrating")
    expect(sprite().still).toBeFalsy()
  })

  test("under Reduce Motion Fern still celebrates, never a still pose", () => {
    mockMotion.reduced = true
    render(surface(), { wrapper })
    expect(sprite().state).toBe("celebrating")
    expect(sprite().still).toBeFalsy()
  })
})

test("a miss consoles instead (a day sealed below target)", () => {
  render(
    <MomentCard
      kind="day"
      label="Day sealed · off target"
      title="Sealed below target"
      detail={<Text>2 left</Text>}
      badge={<Text>·</Text>}
      tint="#a60"
      say="Day sealed"
      hint="Opens today"
      onOpen={() => {}}
      testID="day-moment"
      mood="consoling"
    />,
    { wrapper },
  )
  expect(sprite().state).toBe("consoling")
})

test("a line that is not a win carries no Fern", () => {
  render(<FlashLine text="+180 kcal over" tone="bad" />, { wrapper })
  expect(
    screen.queryByTestId("fern-celebrates", { includeHiddenElements: true }),
  ).toBeNull()
})

// Files that fire the success haptic for something that is not a finish
// or an achievement, or whose celebration is drawn elsewhere.
const NOT_A_FINISH: Record<string, string> = {
  "prototype/motion.tsx":
    "the haptic of a single tick (AnimatedCheck) and a streak chip's bump; the day's all-done moments follow as cards",
  "prototype/screens/habit-timer.tsx":
    "logging one timed habit is a tick; all habits done follows as a day moment",
  "prototype/screens/habit-detail.tsx": "ticking one habit",
  "prototype/screens/tasks.tsx":
    "triage Done on one task; tasks cleared shows on Plan's ring",
  "prototype/screens/finance-record-editor.tsx":
    "a record that reaches a savings goal; the goal's BigMoment (finance-accounts) celebrates it",
  "prototype/wake-word-listener.tsx": "Fern heard its wake word",
  "prototype/companion/chat.tsx": "the drawer opening into the full chat",
  "prototype/companion/blocks.tsx":
    "Fern saved a record from chat; Fern's own reply is beside it",
}
const SHOWS_FERN =
  /<(FernCelebrates|Celebration|MomentCard|BigMoment|FlashLine)\b|export function (Celebration|MomentCard|BigMoment|FlashLine)\b/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory())
      return f === "__tests__" || f === "client" ? [] : files(p)
    return /\.tsx?$/.test(f) ? [p] : []
  })
}

test("every file that celebrates a completion shows Fern celebrating", () => {
  const root = join(__dirname, "..", "..")
  const firing = files(root).filter((p) =>
    readFileSync(p, "utf8").includes("feel.success()"),
  )
  expect(firing.length).toBeGreaterThan(5)
  const missing = firing
    .map((p) => relative(root, p))
    .filter(
      (p) =>
        !NOT_A_FINISH[p] &&
        !SHOWS_FERN.test(readFileSync(join(root, p), "utf8")),
    )
  expect(missing).toEqual([])
  // No stale exemptions: each still fires the haptic.
  for (const p of Object.keys(NOT_A_FINISH))
    expect(firing.map((f) => relative(root, f))).toContain(p)
})
