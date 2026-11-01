// The workout flows end to end on the rendered screens: a sheet that opens
// as another closes waits for it (iOS drops it otherwise), so "Create" in
// the exercise picker really opens the editor and adds the exercise; each
// set shows its own unit; the rest buttons move the timer; and the rest
// alarm follows every change.
import * as A from "@domain/fitness/actions"
import { fitStore } from "@domain/fitness/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import { type ReactNode, useState } from "react"
import { Platform, Pressable, Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

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
// The animated close runs to its end at once, as on a phone with motion on.
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown, _: unknown, done?: (ok: boolean) => void) => {
    done?.(true)
    return value
  },
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
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => {
  const { View } = require("react-native")
  return ({ children }: { children: ReactNode }) => <View>{children}</View>
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({
  copyText: jest.fn(),
  exportCsv: jest.fn(),
  pickPhoto: jest.fn(),
}))
const mockN = {
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  SchedulableTriggerInputTypes: { DATE: "date" },
}
jest.mock("expo-notifications", () => mockN)

const { Sheet } = require("../ui") as typeof import("../ui")
const { WorkoutLogger } =
  require("../screens/fitness-logger") as typeof import("../screens/fitness-logger")
const { startRestAlarm, REST_NOTICE_ID } =
  require("../rest-alarm") as typeof import("../rest-alarm")

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

beforeEach(() => {
  jest.useFakeTimers()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})
afterEach(() => {
  act(() => jest.runOnlyPendingTimers())
  jest.useRealTimers()
})

const startEmpty = () => {
  const res = A.startWorkout({ from: "empty" })
  if (!res.ok) throw new Error(res.reason)
  return res.workout
}
const workout = (id: string) => fitStore.get().workouts.find((x) => x.id === id)

describe("sheet hand-off", () => {
  function Handoff() {
    const [picker, setPicker] = useState(true)
    const [editor, setEditor] = useState(false)
    return (
      <>
        <Sheet title="Picker" open={picker} onClose={() => setPicker(false)}>
          <Pressable
            onPress={() => {
              setPicker(false)
              setEditor(true)
            }}
          >
            <Text>Create</Text>
          </Pressable>
        </Sheet>
        <Sheet title="Editor" open={editor} onClose={() => setEditor(false)}>
          <Text>Editor body</Text>
        </Sheet>
      </>
    )
  }

  it("a sheet opened as another closes waits until that one is gone", () => {
    expect(Platform.OS).toBe("ios")
    render(<Handoff />, { wrapper })
    fireEvent.press(screen.getByText("Create"))
    // The picker is still being dismissed: the editor is not presented yet.
    expect(screen.queryByText("Editor body")).toBeNull()
    act(() => jest.advanceTimersByTime(400))
    expect(screen.getByText("Editor body")).toBeTruthy()
    expect(screen.queryByText("Create")).toBeNull()
  })

  it("onClosed fires once the sheet is gone, so the next one can open", () => {
    function Mounting() {
      const [picker, setPicker] = useState(true)
      const [handoff, setHandoff] = useState(false)
      const [creating, setCreating] = useState(false)
      return (
        <>
          <Sheet
            title="Picker"
            open={picker}
            onClose={() => setPicker(false)}
            onClosed={() => {
              if (handoff) setCreating(true)
              setHandoff(false)
            }}
          >
            <Pressable
              onPress={() => {
                setHandoff(true)
                setPicker(false)
              }}
            >
              <Text>Create</Text>
            </Pressable>
          </Sheet>
          {creating && (
            <Sheet title="Editor" open onClose={() => setCreating(false)}>
              <Text>Editor body</Text>
            </Sheet>
          )}
        </>
      )
    }
    render(<Mounting />, { wrapper })
    fireEvent.press(screen.getByText("Create"))
    expect(screen.queryByText("Editor body")).toBeNull()
    act(() => jest.advanceTimersByTime(400))
    expect(screen.getByText("Editor body")).toBeTruthy()
  })

  it("with nothing closing, a sheet opens at once", () => {
    function One() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Pressable onPress={() => setOpen(true)}>
            <Text>Open</Text>
          </Pressable>
          <Sheet title="Solo" open={open} onClose={() => setOpen(false)}>
            <Text>Solo body</Text>
          </Sheet>
        </>
      )
    }
    render(<One />, { wrapper })
    fireEvent.press(screen.getByText("Open"))
    expect(screen.getByText("Solo body")).toBeTruthy()
  })
})

describe("workout logger", () => {
  it("creates a new exercise from the picker and adds it to the workout", () => {
    const w = startEmpty()
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByText("Add exercise"))
    fireEvent.changeText(
      screen.getByLabelText("Search exercises"),
      "Zercher Squat",
    )
    fireEvent.press(screen.getByText("Create “Zercher Squat”"))
    // Not while the picker is still being dismissed (iOS would drop it).
    expect(screen.queryByLabelText("Exercise name")).toBeNull()
    act(() => jest.advanceTimersByTime(400))
    expect(screen.getByLabelText("Exercise name").props.value).toBe(
      "Zercher Squat",
    )
    fireEvent.press(screen.getByText("Save exercise"))
    const made = fitStore
      .get()
      .exercises.find((e) => e.name === "Zercher Squat")
    expect(made).toBeTruthy()
    expect(workout(w.id)?.exercises.map((e) => e.exerciseId)).toContain(
      made?.id,
    )
    expect(screen.getByText("Zercher Squat")).toBeTruthy()
  })

  // Exercises are one shared catalog: the picker lists live exercises only,
  // and "Create" never makes a second exercise with a name already taken.
  const addCatalog = (...rows: object[]) =>
    fitStore.set((s) => ({
      ...s,
      exercises: [
        ...s.exercises,
        ...rows.map((r) => ({
          equipment: "barbell" as const,
          muscle: "quads" as const,
          loadType: "weight" as const,
          repMin: 5,
          repMax: 8,
          increment: 2.5,
          ...r,
        })),
      ] as typeof s.exercises,
    }))

  it("lists no merged exercise, and a former name finds the live one", () => {
    addCatalog(
      { id: "front", name: "Front Squat", aliases: ["Goblet Front Squat"] },
      { id: "gfs", name: "Goblet Front Squat", mergedInto: "front" },
    )
    startEmpty()
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByText("Add exercise"))
    fireEvent.changeText(
      screen.getByLabelText("Search exercises"),
      "goblet front squat",
    )
    expect(screen.getByText("Front Squat")).toBeTruthy()
    expect(screen.queryByText("Goblet Front Squat")).toBeNull()
    expect(screen.queryByText(/Create “/)).toBeNull()
  })

  it("a name the catalog already has selects that exercise, not a copy", () => {
    addCatalog({ id: "zs", name: "Zercher Squat", archived: true })
    const w = startEmpty()
    const before = fitStore.get().exercises.length
    render(<WorkoutLogger />, { wrapper })
    fireEvent.press(screen.getByText("Add exercise"))
    fireEvent.changeText(
      screen.getByLabelText("Search exercises"),
      "  zercher   SQUAT ",
    )
    expect(screen.queryByText(/Create “/)).toBeNull()
    fireEvent.press(screen.getByLabelText("Use exercise Zercher Squat"))
    act(() => jest.advanceTimersByTime(400))
    // No editor, no new exercise: the existing one joined the workout.
    expect(screen.queryByLabelText("Exercise name")).toBeNull()
    expect(fitStore.get().exercises).toHaveLength(before)
    expect(workout(w.id)?.exercises.map((e) => e.exerciseId)).toEqual(["zs"])
  })

  it("shows every set in its own unit", () => {
    const w = startEmpty()
    const ex = fitStore.get().exercises.find((e) => e.id === "bench")
    if (!ex) throw new Error("seed has no bench")
    const [we] = A.addExercises(w.id, [ex.id])
    const [a, b] =
      workout(w.id)?.exercises[0].sets.filter((x) => x.kind === "working") ?? []
    A.updateSet(w.id, we.id, a.id, { weight: 60, reps: 8 })
    A.updateSet(w.id, we.id, b.id, { weight: 45.36, reps: 8, unit: "lb" })
    render(<WorkoutLogger />, { wrapper })
    // The lb set alone reads in lb; the rest stay in the kg setting.
    expect(screen.getAllByText("100 lb")).toHaveLength(1)
    expect(screen.getAllByText(/^\d+(\.\d)? kg$/).length).toBeGreaterThan(0)
    expect(screen.queryAllByText(/^\d+(\.\d)? lb$/)).toHaveLength(1)
  })

  it("−15 and +15 move the rest countdown", () => {
    startEmpty()
    A.startRest(120)
    render(<WorkoutLogger />, { wrapper })
    expect(screen.getByText("Rest · 120s")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Rest 15 seconds more"))
    expect(screen.getByText("Rest · 135s")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Rest 15 seconds less"))
    fireEvent.press(screen.getByLabelText("Rest 15 seconds less"))
    expect(screen.getByText("Rest · 105s")).toBeTruthy()
    expect(screen.getByText("01:45")).toBeTruthy()
  })
})

describe("rest alarm", () => {
  it("rings at the end of rest, moves with −15/+15 and stops on skip", async () => {
    startRestAlarm()
    const at = () => new Date(fitStore.get().rest?.endsAt ?? 0).getTime()
    const scheduled = () =>
      (
        mockN.scheduleNotificationAsync.mock.calls.at(-1) as unknown as [
          {
            identifier: string
            content: { sound: string }
            trigger: { date: Date }
          },
        ]
      )[0]

    A.startRest(90)
    await waitFor(() =>
      expect(mockN.scheduleNotificationAsync).toHaveBeenCalledTimes(1),
    )
    // Asked once, at the first rest.
    expect(mockN.requestPermissionsAsync).toHaveBeenCalledTimes(1)
    expect(scheduled().identifier).toBe(REST_NOTICE_ID)
    expect(scheduled().content.sound).toBe("default")
    expect(scheduled().trigger.date.getTime()).toBe(at())

    mockN.getPermissionsAsync.mockResolvedValue({ status: "granted" })
    A.adjustRest(15)
    await waitFor(() =>
      expect(mockN.scheduleNotificationAsync).toHaveBeenCalledTimes(2),
    )
    expect(scheduled().trigger.date.getTime()).toBe(at())
    A.adjustRest(-15)
    await waitFor(() =>
      expect(mockN.scheduleNotificationAsync).toHaveBeenCalledTimes(3),
    )
    expect(scheduled().trigger.date.getTime()).toBe(at())

    const cancels = mockN.cancelScheduledNotificationAsync.mock.calls.length
    A.skipRest()
    await waitFor(() =>
      expect(
        mockN.cancelScheduledNotificationAsync.mock.calls.length,
      ).toBeGreaterThan(cancels),
    )
    expect(mockN.scheduleNotificationAsync).toHaveBeenCalledTimes(3)
    expect(mockN.requestPermissionsAsync).toHaveBeenCalledTimes(1)
  })
})
