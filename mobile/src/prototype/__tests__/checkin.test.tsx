// The daily check-in screen the notification opens: Fern's question (no
// model call), one answer through capture with the checkin hint, and the
// day marked so tonight's ask moves to tomorrow.
import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { dayKey } from "@domain/lib/day"
import { configureStorage, resetAll } from "@domain/lib/store"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"

jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    addListener: () => ({ remove: () => {} }),
    start: jest.fn(),
    stop: jest.fn(),
  },
}))
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/today/checkin",
  useFocusEffect: () => {},
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
  withSequence: (...values: unknown[]) => values[values.length - 1],
  withRepeat: (value: unknown) => value,
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
  cancelAnimation: () => {},
  Easing: new Proxy({}, { get: () => () => () => 0 }),
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { CheckIn } =
  require("../screens/checkin") as typeof import("../screens/checkin")

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      {children}
    </SafeAreaProvider>
  </QueryClientProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  captureStore.set((s) => ({ ...s, captures: [] }))
})

test("Fern asks, the answer goes through capture as a check-in", () => {
  render(<CheckIn />, { wrapper })
  expect(screen.getByText("How did today go?")).toBeTruthy()
  fireEvent.changeText(
    screen.getByLabelText("Capture message"),
    "gym done, spent 300 on lunch",
  )
  fireEvent.press(screen.getByLabelText("Send"))
  const cap = captureStore.get().captures.at(-1)
  expect(cap?.hint).toBe("checkin")
  expect(cap?.text).toBe("gym done, spent 300 on lunch")
  expect(dashStore.get().push.lastCheckin).toBe(dayKey())
  expect(screen.getByText("Done")).toBeTruthy()
})
