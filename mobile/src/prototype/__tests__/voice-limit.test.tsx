// The voice recorder counts down to the server's limit and stops there,
// handing over what was recorded, instead of a longer recording being
// refused as "too long" after the fact.

import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen, waitFor } from "@testing-library/react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { CaptureVoice, VOICE_MAX_SEC } from "../screens/capture-voice"

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
    GestureDetector: ({ children }: { children: unknown }) => children,
    ScrollView: require("react-native").ScrollView,
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("@/live/config", () => ({
  ...jest.requireActual("@/live/config"),
  liveMode: true,
}))
jest.mock("@/live/speech", () => ({ stopSpeech: jest.fn() }))

// The recorder's state, driven by each test.
const mockRec = {
  state: { durationMillis: 0, isRecording: false, metering: -40 },
  recorder: {
    uri: "file:///voice.m4a",
    isRecording: false,
    prepareToRecordAsync: jest.fn(async () => {}),
    record: jest.fn(() => {
      mockRec.recorder.isRecording = true
      mockRec.state = { ...mockRec.state, isRecording: true }
    }),
    pause: jest.fn(),
    stop: jest.fn(async () => {}),
  },
}
jest.mock("expo-audio", () => ({
  AudioModule: {
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
  },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(async () => {}),
  useAudioRecorder: () => mockRec.recorder,
  useAudioRecorderState: () => mockRec.state,
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockRec.state = { durationMillis: 0, isRecording: false, metering: -40 }
  mockRec.recorder.isRecording = false
  jest.clearAllMocks()
})

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const sheet = (onRecording: jest.Mock) => (
  <SafeAreaProvider initialMetrics={metrics}>
    <CaptureVoice
      hint="journal"
      onClose={jest.fn()}
      onDone={jest.fn()}
      onRecording={onRecording}
    />
  </SafeAreaProvider>
)

test("the limit is the server's five minutes", () => {
  expect(VOICE_MAX_SEC).toBe(300)
})

test("recording shows the time left, and warns near the limit", async () => {
  const onRecording = jest.fn()
  const r = render(sheet(onRecording))
  await waitFor(() => expect(mockRec.recorder.record).toHaveBeenCalled())
  mockRec.state = { ...mockRec.state, durationMillis: 48_000 }
  r.rerender(sheet(onRecording))
  expect(screen.getByText("04:12 left")).toBeTruthy()
  mockRec.state = { ...mockRec.state, durationMillis: 290_000 }
  r.rerender(sheet(onRecording))
  expect(screen.getByText("00:10 left · stops at 05:00")).toBeTruthy()
  expect(onRecording).not.toHaveBeenCalled()
})

test("at the limit it stops by itself and keeps the recording", async () => {
  const onRecording = jest.fn()
  const r = render(sheet(onRecording))
  await waitFor(() => expect(mockRec.recorder.record).toHaveBeenCalled())
  mockRec.state = { ...mockRec.state, durationMillis: 300_400 }
  await act(async () => r.rerender(sheet(onRecording)))
  await waitFor(() =>
    expect(onRecording).toHaveBeenCalledWith("file:///voice.m4a", 300),
  )
  expect(mockRec.recorder.stop).toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(
    "Stopped at the 5-minute limit. Your recording is kept.",
  )
})
