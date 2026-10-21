// The paperclip opens the device's file picker at once, and the chosen file
// itself (not only its name) goes out with the capture.
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { CaptureFile } from "../screens/capture-photo"

const mockPick = jest.fn()
const mockSend = jest.fn((..._a: unknown[]) => "cap-1")
jest.mock("expo-document-picker", () => ({
  getDocumentAsync: (...a: unknown[]) => mockPick(...a),
}))
jest.mock("@domain/capture/actions", () => ({
  ...jest.requireActual("@domain/capture/actions"),
  sendCapture: (...a: unknown[]) => mockSend(...a),
}))
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

jest.mock("react-native-gesture-handler", () => {
  // Chainable no-op gesture builder; the detector just renders its child.
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
  mockPick.mockReset()
  mockSend.mockClear()
})

test("opens the picker right away and sends the picked file", async () => {
  mockPick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: "gcash-oct.pdf",
        uri: "file:///cache/gcash-oct.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    ],
  })
  render(<CaptureFile onClose={jest.fn()} />, { wrapper })
  await act(async () => {})
  expect(mockPick).toHaveBeenCalledTimes(1)
  expect(screen.getByText("gcash-oct.pdf")).toBeTruthy()
  fireEvent.press(
    screen.getByRole("button", { name: "Hand off to Finance import" }),
  )
  const account = finStore.get().accounts.find((a) => !a.archived)?.id
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({
      source: "file",
      fileUri: "file:///cache/gcash-oct.pdf",
      fileMime: "application/pdf",
      hint: account,
    }),
  )
})

test("cancelling the picker closes the sheet", async () => {
  mockPick.mockResolvedValue({ canceled: true, assets: null })
  const onClose = jest.fn()
  render(<CaptureFile onClose={onClose} />, { wrapper })
  await act(async () => {})
  expect(onClose).toHaveBeenCalled()
})
