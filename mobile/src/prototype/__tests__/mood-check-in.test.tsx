// A one-tap mood check-in on Today: one per day (tapping again changes it),
// stored as a journal entry tagged "check-in" so Journal's mood trend sees
// it, but kept out of the entry list and never ticking the Journal habit.
import { addJournalEntry, checkInMood } from "@domain/capture/actions"
import { CHECK_IN } from "@domain/capture/data"
import { captureStore } from "@domain/capture/store"
import { habitsStore } from "@domain/habits/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Journal } from "../screens/journal"
import { MoodCheckIn } from "../screens/mood-check-in"

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
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const checkIns = () =>
  captureStore.get().journal.filter((j) => j.tags.includes(CHECK_IN))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  captureStore.set((s) => ({ ...s, journal: [] }))
  habitsStore.set((s) => ({
    ...s,
    habits: [
      {
        ...(s.habits[0] as (typeof s.habits)[number]),
        id: "h-journal",
        name: "Journal",
        status: "active",
      },
    ],
    logs: [],
  }))
})

test("one check-in a day: tapping again changes it", () => {
  checkInMood(4)
  checkInMood(2)
  expect(checkIns()).toEqual([
    expect.objectContaining({
      day: dayKey(),
      mood: 2,
      body: "Mood check-in: Meh",
      tags: [CHECK_IN],
    }),
  ])
})

test("a check-in never ticks the Journal habit; a written entry still does", () => {
  checkInMood(5)
  expect(habitsStore.get().logs).toHaveLength(0)
  addJournalEntry({ body: "Long walk after work" })
  expect(habitsStore.get().logs).toHaveLength(1)
})

test("card: tap a face to check in, the face stays picked", () => {
  render(<MoodCheckIn />)
  expect(screen.getByText("How's today?")).toBeTruthy()
  fireEvent.press(screen.getByLabelText("Good"))
  expect(checkIns()[0]?.mood).toBe(4)
  expect(screen.getByLabelText("Good").props.accessibilityState).toMatchObject({
    selected: true,
  })
  fireEvent.press(screen.getByLabelText("Great"))
  expect(checkIns()).toHaveLength(1)
  expect(checkIns()[0]?.mood).toBe(5)
})

test("card: tapping the picked face again leaves today's check-in alone", () => {
  render(<MoodCheckIn />)
  fireEvent.press(screen.getByLabelText("Good"))
  fireEvent.press(screen.getByLabelText("Good"))
  expect(checkIns()[0]?.mood).toBe(4)
})

test("Journal: check-ins stay out of the entry list and streak", () => {
  checkInMood(3)
  render(<Journal />, { wrapper })
  expect(screen.queryByText("Mood check-in: Okay")).toBeNull()
  expect(screen.getByText("Your journal is empty")).toBeTruthy()
})
