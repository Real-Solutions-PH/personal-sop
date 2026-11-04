// Swapping an exercise on Edit template: a tap on the exercise's name opens
// the exercise list, and the one pick takes that row's place, keeping its
// position and its sets. Adding exercises still adds them at the end.
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/fitness/templates/x",
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
  withDelay: (_: number, value: unknown) => value,
  withSequence: (...v: unknown[]) => v.at(-1),
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
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
jest.mock("expo-audio", () => ({}))
jest.mock("../run-tracker", () => ({
  finishAndStop: jest.fn(),
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
}))
// Health and the body section have their own suites.
jest.mock("../screens/steps-card", () => ({ StepsCard: () => null }))
jest.mock("../screens/sleep-card", () => ({ SleepCard: () => null }))
jest.mock("../screens/fitness-body", () => ({ Body: () => null }))

const { Templates } =
  require("../screens/fitness-templates") as typeof import("../screens/fitness-templates")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
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
  jest.clearAllMocks()
})

const nameOf = (id: string) =>
  fitStore.get().exercises.find((e) => e.id === id)?.name ?? ""

test("a tap on an exercise swaps it in place, keeping its spot and sets", () => {
  const tpl = fitStore.get().templates[0]
  expect(tpl.items.length).toBeGreaterThan(2)
  // Give the second row a set count of its own, to see it kept.
  act(() =>
    fitStore.set((s) => ({
      ...s,
      templates: s.templates.map((x) =>
        x.id === tpl.id
          ? {
              ...x,
              items: x.items.map((it, i) =>
                i === 1 ? { ...it, sets: 5 } : it,
              ),
            }
          : x,
      ),
    })),
  )
  const before = fitStore.get().templates[0].items
  const target = before[1]
  const replacement = fitStore
    .get()
    .exercises.find(
      (e) => !e.archived && !before.some((it) => it.exerciseId === e.id),
    )
  if (!replacement) throw new Error("no spare exercise to swap to")
  render(<Templates id={tpl.id} />, { wrapper })

  fireEvent.press(screen.getByLabelText(`Swap ${nameOf(target.exerciseId)}`))
  expect(screen.getByText(`Swap ${nameOf(target.exerciseId)}`)).toBeTruthy()
  // One pick lands at once: no checkboxes, no "Add" button.
  expect(screen.queryByText(/^Add \d* ?exercises$/)).toBeNull()
  fireEvent.press(screen.getByLabelText(`Swap to ${replacement.name}`))

  // The new exercise sits in the same row, with the same five sets.
  const swaps = screen.getAllByLabelText(/^Swap /)
  expect(swaps.map((n) => n.props.accessibilityLabel)).toEqual(
    before.map((it, i) =>
      i === 1 ? `Swap ${replacement.name}` : `Swap ${nameOf(it.exerciseId)}`,
    ),
  )
  expect(screen.getByText("5 sets")).toBeTruthy()

  fireEvent.press(screen.getByText("Save"))
  const saved = fitStore.get().templates.find((x) => x.id === tpl.id)?.items
  expect(saved?.map((it) => it.exerciseId)).toEqual(
    before.map((it, i) => (i === 1 ? replacement.id : it.exerciseId)),
  )
  expect(saved?.[1].sets).toBe(5)
  expect(saved).toHaveLength(before.length)
})

test("Add exercise still adds at the end, several at a time", () => {
  const tpl = fitStore.get().templates[0]
  const before = tpl.items
  const spare = fitStore
    .get()
    .exercises.filter(
      (e) => !e.archived && !before.some((it) => it.exerciseId === e.id),
    )
    .slice(0, 2)
  render(<Templates id={tpl.id} />, { wrapper })
  fireEvent.press(screen.getByText("Add exercise"))
  expect(screen.getAllByText("Add exercises").length).toBeGreaterThan(0)
  for (const e of spare) fireEvent.press(screen.getByText(e.name))
  fireEvent.press(screen.getByText("Add 2 exercises"))
  fireEvent.press(screen.getByText("Save"))
  const saved = fitStore.get().templates.find((x) => x.id === tpl.id)?.items
  expect(saved?.map((it) => it.exerciseId)).toEqual([
    ...before.map((it) => it.exerciseId),
    ...spare.map((e) => e.id),
  ])
})
