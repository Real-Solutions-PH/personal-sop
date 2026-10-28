// Logging sets: a set can be deleted and put back where it was, weight can
// be entered in pounds and is saved in kilograms, and a missing exercise
// can be created from where it was searched for.
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
// The sheet's drag-to-dismiss wrapper; the editor's fields are under test.
jest.mock("react-native-gesture-handler", () => ({
  ...jest.requireActual("react-native-gesture-handler"),
  GestureDetector: ({ children }: { children: unknown }) => children,
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { SetEditor } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { CreateExerciseRow } =
  require("../screens/fitness") as typeof import("../screens/fitness")

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
})

const started = () => {
  const ex = fitStore.get().exercises[0]
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  const w = res.workout
  const [we] = A.addExercises(w.id, [ex.id])
  return { w, we }
}
const setsOf = (wid: string, weId: string) =>
  fitStore
    .get()
    .workouts.find((x) => x.id === wid)
    ?.exercises.find((e) => e.id === weId)
    ?.sets.map((x) => x.id)

it("a deleted set comes back in its place on undo", () => {
  const { w, we } = started()
  const ids = setsOf(w.id, we.id) as string[]
  expect(ids.length).toBeGreaterThan(2)
  const removed = A.removeSet(w.id, we.id, ids[1])
  expect(setsOf(w.id, we.id)).toEqual(ids.filter((_, i) => i !== 1))
  A.restoreSet(w.id, we.id, removed!)
  expect(setsOf(w.id, we.id)).toEqual(ids)
})

it("converts pounds and kilograms to a tenth", () => {
  expect(A.lbToKg(30)).toBe(13.608)
  expect(A.lbToKg(45)).toBe(20.412)
  // Kept to the gram, so pounds come back exact.
  expect(A.kgToLb(A.lbToKg(135))).toBe(135)
  expect(A.kgToLb(20)).toBe(44.1)
})

it("a weight typed in pounds is saved in kilograms", () => {
  A.updateSettings({ units: "lb" })
  const onSave = jest.fn()
  render(
    <SetEditor
      set={{ id: "s", weight: 13.6, reps: 5, kind: "working" }}
      open
      onClose={() => {}}
      onSave={onSave}
      onDelete={() => {}}
    />,
    { wrapper },
  )
  // Shown in pounds.
  expect(screen.getByLabelText("Weight (lb)").props.value).toBe("30")
  fireEvent.changeText(screen.getByLabelText("Weight (lb)"), "45")
  expect(screen.getByText(/= 20.4 kg/)).toBeTruthy()
  fireEvent.press(screen.getByText("Save"))
  expect(onSave).toHaveBeenCalledWith({
    weight: 20.412,
    reps: 5,
    kind: "working",
    unit: "lb",
  })
})

it("switching one set to pounds keeps the others, and the setting, in kg", () => {
  const onSave = jest.fn()
  render(
    <SetEditor
      set={{ id: "s", weight: 20, reps: 5, kind: "working" }}
      open
      onClose={() => {}}
      onSave={onSave}
      onDelete={() => {}}
    />,
    { wrapper },
  )
  fireEvent.press(screen.getByText("lb"))
  expect(screen.getByLabelText("Weight (lb)").props.value).toBe("44.1")
  fireEvent.press(screen.getByText("Save"))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ weight: 20, unit: "lb" }),
  )
  expect(fitStore.get().settings.units).toBe("kg")
})

it("offers to create an exercise the search didn't find, not one it did", () => {
  const onPress = jest.fn()
  const known = fitStore.get().exercises[0].name
  const { rerender } = render(
    <CreateExerciseRow query="Zercher squat" onPress={onPress} />,
    { wrapper },
  )
  fireEvent.press(screen.getByText("Create “Zercher squat”"))
  expect(onPress).toHaveBeenCalledWith("Zercher squat")
  rerender(<CreateExerciseRow query={known.toUpperCase()} onPress={onPress} />)
  expect(screen.queryByText(/Create/)).toBeNull()
})
