// The full Fern chat opened with ?thread= (a tap on Fern's "replied" push)
// shows that chat, not the latest one.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { CompanionChat } from "../companion/chat"
import {
  addMessage,
  chatMessages,
  companionStore,
  currentThread,
  newChat,
} from "../companion/store"
import { chatPage } from "../notifications"

const params: { thread?: string } = {}
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => params,
  usePathname: () => "/capture",
}))
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  delete params.thread
})

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const state = () => companionStore.get()

test("?thread= opens that chat, and the page counts as on screen", () => {
  addMessage({ role: "me", text: "the older chat" })
  const older = currentThread(state()) as string
  newChat()
  addMessage({ role: "me", text: "the newer chat" })
  params.thread = older
  const view = render(<CompanionChat />, { wrapper })
  expect(chatMessages(state()).map((m) => m.text)).toEqual(["the older chat"])
  expect(chatPage.getState().on).toBe(true)
  act(() => view.unmount())
  expect(chatPage.getState().on).toBe(false)
})
