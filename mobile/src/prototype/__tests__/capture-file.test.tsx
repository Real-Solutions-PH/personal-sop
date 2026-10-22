// The paperclip opens the device's file picker at once (no sheet), several
// files can be picked, and each file itself goes out as its own capture.
import { finStore } from "@domain/finance/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import type { ReactNode } from "react"
import { attachFiles } from "../screens/capture-photo"

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

test("sends every picked file as its own capture, in one go", async () => {
  mockPick.mockResolvedValue({
    canceled: false,
    assets: [
      {
        name: "gcash-oct.pdf",
        uri: "file:///cache/gcash-oct.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
      {
        name: "bpi-oct.csv",
        uri: "file:///cache/bpi-oct.csv",
        mimeType: "text/csv",
        size: 512,
      },
    ],
  })
  const onSent = jest.fn()
  await attachFiles(onSent)
  expect(mockPick).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: true }),
  )
  const account = finStore.get().accounts.find((a) => !a.archived)?.id
  expect(mockSend).toHaveBeenCalledTimes(2)
  expect(mockSend).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      source: "file",
      fileUri: "file:///cache/gcash-oct.pdf",
      fileMime: "application/pdf",
      hint: account,
    }),
  )
  expect(mockSend).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ fileUri: "file:///cache/bpi-oct.csv" }),
  )
  expect(onSent).toHaveBeenCalledWith("cap-1")
})

test("cancelling the picker sends nothing", async () => {
  mockPick.mockResolvedValue({ canceled: true, assets: null })
  const onSent = jest.fn()
  await attachFiles(onSent)
  expect(mockSend).not.toHaveBeenCalled()
  expect(onSent).not.toHaveBeenCalled()
})
