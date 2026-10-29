// Every time Fern's drawer opens it starts a new chat; earlier chats stay
// in the Chats list, reachable from the drawer's header.
import { closeCapture, openCapture } from "@domain/lib/capture"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { CompanionDrawer } from "../companion/chat"
import {
  addMessage,
  chatList,
  chatMessages,
  companionStore,
  currentThread,
  replying,
} from "../companion/store"

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  replying.setState({ id: null })
})

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const state = () => companionStore.get()

test("each open of the drawer starts a new chat, reusing an untouched one", () => {
  addMessage({ role: "me", text: "planning a trip to Cebu" })
  const earlier = currentThread(state())
  render(<CompanionDrawer bottom={83} />, { wrapper })

  act(() => openCapture())
  const first = currentThread(state())
  expect(first).not.toBe(earlier)
  expect(chatMessages(state())).toEqual([])

  // Closed without a word: the same empty chat comes back, none piles up.
  act(() => closeCapture())
  act(() => openCapture())
  expect(currentThread(state())).toBe(first)
  expect(chatList(state())).toHaveLength(2)

  // Once it has a message, the next open is a new chat again.
  act(() => {
    addMessage({ role: "me", text: "what's for dinner?" })
  })
  act(() => closeCapture())
  act(() => openCapture())
  expect(currentThread(state())).not.toBe(first)
  expect(chatList(state())).toHaveLength(3)
})

test("a reply still being written keeps its chat when the drawer reopens", () => {
  addMessage({ role: "me", text: "plan my week" })
  const asked = currentThread(state())
  replying.setState({ id: "question-1" })
  render(<CompanionDrawer bottom={83} />, { wrapper })
  act(() => openCapture())
  expect(currentThread(state())).toBe(asked)
})

test("the drawer's header opens the earlier chats", () => {
  addMessage({ role: "me", text: "planning a trip to Cebu" })
  render(<CompanionDrawer bottom={83} />, { wrapper })
  act(() => openCapture())
  fireEvent.press(screen.getByLabelText("Chats"))
  // The sheet is its own modal window on a phone; the test renderer draws
  // it beside the drawer, whose accessibilityViewIsModal hides siblings.
  fireEvent.press(
    screen.getByLabelText("Open planning a trip to Cebu", {
      includeHiddenElements: true,
    }),
  )
  expect(chatMessages(state()).map((m) => m.text)).toEqual([
    "planning a trip to Cebu",
  ])
})
