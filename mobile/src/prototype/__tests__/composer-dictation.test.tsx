// Fern's composer dictates into the box; the capture screen's composer keeps
// its quick add and voice capture (ADR-0015).
import { configureStorage, resetAll } from "@domain/lib/store"
import { render, screen } from "@testing-library/react-native"
import { ThreadComposer } from "../screens/capture-thread"

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

jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
})

test("Fern's composer offers dictation and no quick add", () => {
  render(<ThreadComposer onText={jest.fn()} hints={false} />)
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy()
  expect(screen.queryByRole("button", { name: "Quick add" })).toBeNull()
})

test("the capture screen's composer keeps quick add and voice capture", () => {
  render(<ThreadComposer hints={false} />)
  expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Quick add" })).toBeTruthy()
})
