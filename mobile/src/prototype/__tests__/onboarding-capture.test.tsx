// Onboarding's first Fern capture: a misheard voice transcript lands in a
// field the person can correct before it is sent, what they type is never
// overwritten by the recogniser, and once sent Fern's answer shows on the
// same screen.
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Pressable, Text } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"

type Listener = (e: never) => void
const mockListeners: Record<string, Listener> = {}
const mockModule = {
  isRecognitionAvailable: jest.fn(() => true),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  start: jest.fn(),
  stop: jest.fn(),
  abort: jest.fn(),
  addListener: jest.fn((name: string, fn: Listener) => {
    mockListeners[name] = fn
    return { remove: jest.fn() }
  }),
}
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: mockModule,
}))
jest.mock("expo-audio", () => ({}))
jest.mock("expo-file-system", () => ({}))
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withRepeat: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))

const { FirstCaptureStep } =
  require("../screens/onboarding-capture") as typeof import("../screens/onboarding-capture")
type Held = import("../first-capture").HeldCapture

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const fire = (name: string, e: unknown) =>
  act(() => mockListeners[name](e as never))

let lastHeld: Held | null = null
const { firstCaptureStore } =
  require("../first-capture") as typeof import("../first-capture")
const { captureStore } =
  require("@domain/capture/store") as typeof import("@domain/capture/store")
function Harness() {
  return (
    <FirstCaptureStep
      onSend={(c) => {
        lastHeld = c
      }}
      onNext={() => {}}
      button={(label: string, press: () => void, _q, disabled) => (
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={press}
        >
          <Text>{label}</Text>
        </Pressable>
      )}
    />
  )
}
const show = () =>
  render(<Harness />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
    ),
  })
const field = () => screen.getByLabelText("One thing from today")

beforeEach(() => {
  jest.clearAllMocks()
  lastHeld = null
  firstCaptureStore.set({ pending: null, sentId: null })
})

test("a misheard transcript can be corrected while dictating, and the recogniser does not type over the fix", async () => {
  show()
  await act(async () => {
    fireEvent.press(screen.getByLabelText("Dictate"))
  })
  expect(mockModule.start).toHaveBeenCalled()
  fire("result", { isFinal: false, results: [{ transcript: "spent 15 on" }] })
  fire("result", {
    isFinal: true,
    results: [{ transcript: "spent 15 on lunch" }],
  })
  expect(field().props.value).toBe("spent 15 on lunch")
  // The person fixes the amount while the mic is still on.
  fireEvent.changeText(field(), "spent 150 on lunch")
  expect(mockModule.stop).toHaveBeenCalled()
  // A late result from the recogniser does not undo the correction.
  fire("result", {
    isFinal: true,
    results: [{ transcript: "spent 15 on lunch today" }],
  })
  expect(field().props.value).toBe("spent 150 on lunch")
  fire("end", null)
  fireEvent.press(screen.getByText("Log it"))
  expect(lastHeld).toEqual({ text: "spent 150 on lunch", source: "voice" })
})

test("once sent, Fern's answer shows here with Next", () => {
  show()
  fireEvent.changeText(field(), "ran 5k")
  fireEvent.press(screen.getByText("Log it"))
  expect(lastHeld).toEqual({ text: "ran 5k", source: "text" })
  // The send went through the capture path (first-capture.ts).
  act(() => {
    captureStore.set((st) => ({
      ...st,
      captures: [
        {
          id: "c1",
          at: new Date().toISOString(),
          source: "text",
          text: "ran 5k",
          status: "processing" as const,
          clientUuid: "u-c1",
        },
        ...st.captures,
      ],
    }))
    firstCaptureStore.set({ pending: null, sentId: "c1" })
  })
  expect(screen.getByText("Fern is logging it…")).toBeTruthy()
  expect(screen.getByText("“ran 5k”")).toBeTruthy()
  expect(screen.getByText("Next")).toBeTruthy()
  expect(screen.queryByLabelText("One thing from today")).toBeNull()
})

test("dictating again after a correction picks up from the corrected words", async () => {
  show()
  fireEvent.changeText(field(), "call mum")
  await act(async () => {
    fireEvent.press(screen.getByLabelText("Dictate"))
  })
  fire("result", { isFinal: false, results: [{ transcript: "friday" }] })
  expect(field().props.value).toBe("call mum friday")
})
