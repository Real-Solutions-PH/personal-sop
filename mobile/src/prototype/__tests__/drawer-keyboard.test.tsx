// The drawer's composer rises with the phone's keyboard (feedback on
// 2026-10-22: the text box stayed under the keyboard).
import { openCapture } from "@domain/lib/capture"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Keyboard, StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { CompanionDrawer } from "../companion/chat"

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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const handlers: Record<string, (e: unknown) => void> = {}
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.spyOn(Keyboard, "addListener").mockImplementation(((
    name: string,
    fn: (e: unknown) => void,
  ) => {
    handlers[name] = fn
    return { remove: () => {} }
  }) as unknown as typeof Keyboard.addListener)
})

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)

test("the composer lifts by the keyboard's height above the tab bar", () => {
  act(() => openCapture())
  render(<CompanionDrawer bottom={83} />, { wrapper })
  const body = () =>
    StyleSheet.flatten(screen.getByTestId("companion-drawer-body").props.style)
  expect(body().paddingBottom).toBe(0)
  act(() => handlers.keyboardWillShow({ endCoordinates: { height: 336 } }))
  expect(body().paddingBottom).toBe(336 - 83)
  act(() => handlers.keyboardWillHide({}))
  expect(body().paddingBottom).toBe(0)
})
