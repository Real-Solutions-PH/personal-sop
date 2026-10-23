// Fern's composer dictates into the box and keeps the quick add button; the
// capture screen's composer records voice captures.

import type { Capture } from "@domain/capture/data"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { Exchange, ThreadComposer } from "../screens/capture-thread"

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

test("Fern's composer offers dictation and the quick add button", () => {
  render(<ThreadComposer onText={jest.fn()} hints={false} />)
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Quick add" })).toBeTruthy()
})

test("with words in the box, dictation keeps its own button beside Send", () => {
  render(<ThreadComposer onText={jest.fn()} hints={false} />)
  fireEvent.changeText(screen.getByLabelText("Capture message"), "Had eggs and")
  expect(screen.getByRole("button", { name: "Send" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Dictate" })).toBeTruthy()
})

test("the capture screen's composer keeps quick add and voice capture", () => {
  render(<ThreadComposer hints={false} />)
  expect(screen.getByRole("button", { name: "Record voice" })).toBeTruthy()
  expect(screen.getByRole("button", { name: "Quick add" })).toBeTruthy()
})

test("a capture of two photos shows both in its bubble", () => {
  const cap = {
    id: "c1",
    at: new Date().toISOString(),
    source: "photo",
    status: "done",
    text: "Dinner: pancit canton and chicken",
    hint: "meal",
    photo: "file:///a.jpg",
    photos: ["file:///b.jpg"],
    items: [],
  } as unknown as Capture
  render(<Exchange cap={cap} />)
  expect(screen.getByLabelText("2 photos")).toBeTruthy()
})

test("a box that grew is rebuilt at one line once it is cleared", () => {
  render(<ThreadComposer onText={jest.fn()} hints={false} />)
  const first = screen.getByLabelText("Capture message")
  fireEvent.changeText(first, "a long message\nover\nseveral\nlines")
  fireEvent(first, "contentSizeChange", {
    nativeEvent: { contentSize: { width: 200, height: 104 } },
  })
  // Sent: the text is cleared while Fern answers.
  fireEvent.changeText(first, "")
  const after = screen.getByLabelText("Capture message")
  // A fresh input, so iOS lays it out at one line again.
  expect(after).not.toBe(first)
  expect(after.props.value).toBe("")
})

test("a one-line box is not rebuilt when cleared", () => {
  render(<ThreadComposer onText={jest.fn()} hints={false} />)
  const first = screen.getByLabelText("Capture message")
  fireEvent.changeText(first, "hi")
  fireEvent(first, "contentSizeChange", {
    nativeEvent: { contentSize: { width: 200, height: 44 } },
  })
  fireEvent.changeText(first, "")
  expect(screen.getByLabelText("Capture message")).toBe(first)
})
