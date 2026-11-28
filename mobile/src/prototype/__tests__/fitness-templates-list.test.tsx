// The Templates list belongs to the Weekly routine: its header back and
// Android's hardware back both land on /fitness/routine, whatever screen
// the stack came from. A free workout the person logged shows in it with
// its exercises, sets and "last <day>".
import * as A from "@domain/fitness/actions"
import * as C from "@domain/fitness/calc"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { BackHandler } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismissTo: jest.fn(),
    canGoBack: () => false,
  },
  useFocusEffect: (cb: () => undefined | (() => void)) =>
    require("react").useEffect(cb, [cb]),
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
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
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
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
jest.mock("../run-tracker", () => ({
  finishAndStop: jest.fn(),
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
}))
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

test("the header back goes to the Weekly routine", () => {
  render(<Templates />, { wrapper })
  fireEvent.press(screen.getByLabelText("Back"))
  expect(router.dismissTo).toHaveBeenCalledWith("/fitness/routine")
  expect(router.back).not.toHaveBeenCalled()
})

test("Android's hardware back goes to the Weekly routine too", () => {
  const add = jest.spyOn(BackHandler, "addEventListener")
  const view = render(<Templates />, { wrapper })
  const handler = add.mock.calls.find((c) => c[0] === "hardwareBackPress")?.[1]
  expect(handler).toBeDefined()
  let handled: boolean | null | undefined
  act(() => {
    handled = handler?.()
  })
  expect(handled).toBe(true)
  expect(router.dismissTo).toHaveBeenCalledWith("/fitness/routine")
  view.unmount()
  add.mockRestore()
})

test("a template's own page keeps the ordinary back", () => {
  const tpl = fitStore.get().templates[0]
  const add = jest.spyOn(BackHandler, "addEventListener")
  render(<Templates id={tpl.id} />, { wrapper })
  expect(add.mock.calls.some((c) => c[0] === "hardwareBackPress")).toBe(false)
  add.mockRestore()
})

test("a logged free workout is listed with its sets and last day", () => {
  const ex = fitStore.get().exercises.find((e) => !C.isTimed(e))
  if (!ex) throw new Error("no exercise in the sample data")
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  A.updateWorkoutMeta(res.workout.id, { name: "Garage session" })
  const [we] = A.addExercises(res.workout.id, [ex.id])
  const sets = () =>
    fitStore
      .get()
      .workouts.find((w) => w.id === res.workout.id)
      ?.exercises.find((e) => e.id === we.id)?.sets ?? []
  for (const x of sets()) A.removeSet(res.workout.id, we.id, x.id)
  for (let i = 0; i < 4; i++) A.addSet(res.workout.id, we.id)
  for (const x of sets()) A.toggleSet(res.workout.id, we.id, x.id)
  A.finishWorkout(res.workout.id)
  render(<Templates />, { wrapper })
  expect(screen.getByText("Garage session")).toBeTruthy()
  expect(screen.getByText("1 exercise · 4 sets · last Today")).toBeTruthy()
})
