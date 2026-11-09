// Built-in exercises and routines show a quiet "Built-in" marker and no
// edit controls; the person's own show every control. A built-in routine
// offers Start and Copy instead of the editor.
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
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

const { Exercises } =
  require("../screens/fitness-exercises") as typeof import("../screens/fitness-exercises")
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
  fitStore.set((s) => ({
    ...s,
    workouts: [],
    exercises: [
      {
        id: "bench",
        name: "Barbell Bench Press",
        equipment: "barbell",
        muscle: "chest",
        loadType: "weight",
        repMin: 6,
        repMax: 10,
        increment: 2.5,
        builtIn: true,
      },
      {
        id: "mine",
        name: "Sled push",
        equipment: "machine",
        muscle: "chest",
        loadType: "weight",
        repMin: 8,
        repMax: 12,
        increment: 5,
      },
    ],
    templates: [
      {
        id: "push-a",
        name: "Push A",
        items: [{ exerciseId: "bench", sets: 3 }],
        builtIn: true,
      },
      {
        id: "my-day",
        name: "Sled day",
        items: [
          { exerciseId: "mine", sets: 4 },
          { exerciseId: "bench", sets: 3 },
        ],
      },
    ],
  }))
})

describe("exercises", () => {
  it("the list marks the built-in one only", () => {
    render(<Exercises />, { wrapper })
    expect(screen.getByText("Barbell Bench Press")).toBeTruthy()
    expect(screen.getByText("Sled push")).toBeTruthy()
    expect(screen.getAllByText("Built-in")).toHaveLength(1)
  })

  it("a built-in exercise shows no edit, merge or archive control", () => {
    render(<Exercises id="bench" />, { wrapper })
    expect(screen.getByText("Built-in")).toBeTruthy()
    expect(screen.queryByLabelText("Edit exercise")).toBeNull()
    expect(screen.queryByText("Merge into another exercise")).toBeNull()
    expect(screen.queryByText("Archive exercise")).toBeNull()
  })

  it("my own exercise shows every control", () => {
    render(<Exercises id="mine" />, { wrapper })
    expect(screen.queryByText("Built-in")).toBeNull()
    expect(screen.getByLabelText("Edit exercise")).toBeTruthy()
    expect(screen.getByText("Merge into another exercise")).toBeTruthy()
    expect(screen.getByText("Archive exercise")).toBeTruthy()
  })
})

describe("templates", () => {
  it("the list marks the built-in one only", () => {
    render(<Templates />, { wrapper })
    expect(screen.getByText("Push A")).toBeTruthy()
    expect(screen.getByText("Sled day")).toBeTruthy()
    expect(screen.getAllByText("Built-in")).toHaveLength(1)
  })

  it("a built-in routine is read-only: start it or copy it", () => {
    render(<Templates id="push-a" />, { wrapper })
    expect(screen.getByText("Built-in")).toBeTruthy()
    expect(screen.getByText("Barbell Bench Press")).toBeTruthy()
    expect(screen.queryByLabelText("Template name")).toBeNull()
    expect(screen.queryByLabelText(/^Swap /)).toBeNull()
    expect(screen.queryByLabelText("Remove exercise")).toBeNull()
    expect(screen.queryByLabelText("More sets")).toBeNull()
    expect(screen.queryByText("Add exercise")).toBeNull()
    expect(screen.queryByText("Delete template")).toBeNull()
    expect(screen.getByText("Start this template")).toBeTruthy()

    fireEvent.press(screen.getByText("Copy to my templates"))
    const copy = fitStore
      .get()
      .templates.find((t) => t.name === "Push A (copy)")
    expect(copy).toBeTruthy()
    expect(copy?.builtIn).toBeUndefined()
    expect(copy?.items).toEqual([{ exerciseId: "bench", sets: 3 }])
    expect(router.replace).toHaveBeenCalledWith(
      `/fitness/templates/${copy?.id}`,
    )
    // The built-in itself is unchanged.
    expect(fitStore.get().templates.find((t) => t.id === "push-a")?.name).toBe(
      "Push A",
    )
  })

  it("my own routine opens in the editor with every control", () => {
    render(<Templates id="my-day" />, { wrapper })
    expect(screen.queryByText("Built-in")).toBeNull()
    expect(screen.getByLabelText("Template name")).toBeTruthy()
    expect(screen.getByLabelText("Swap Sled push")).toBeTruthy()
    expect(screen.getAllByLabelText("Remove exercise")).toHaveLength(2)
    expect(screen.getByText("Add exercise")).toBeTruthy()
    expect(screen.getByText("Delete template")).toBeTruthy()
  })
})

it("a built-in routine survives the actions even when asked directly", () => {
  expect(A.deleteTemplate("push-a")).toBeUndefined()
  expect(fitStore.get().templates.some((t) => t.id === "push-a")).toBe(true)
})
