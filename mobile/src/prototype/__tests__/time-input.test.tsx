// One tap on a time opens the wheel. On iOS that is a sheet with the wheel
// already showing, not a compact button that needs a second tap.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { Platform } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { TimeInput } from "../time-input"

jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native")
  return {
    __esModule: true,
    default: (p: { testID?: string; display?: string }) => (
      <View testID={p.testID ?? "picker"} accessibilityHint={p.display} />
    ),
  }
})
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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
  interpolate: (_: number, __: number[], output: number[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
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
  Platform.OS = "ios"
})

test("on iOS one tap shows the wheel, and Done keeps the time", () => {
  const onChange = jest.fn()
  render(<TimeInput value="07:00" onChange={onChange} label="Plan my day" />, {
    wrapper,
  })
  expect(screen.queryByTestId("time-wheel")).toBeNull()
  fireEvent.press(screen.getByLabelText("Plan my day"))
  expect(screen.getByTestId("time-wheel").props.accessibilityHint).toBe(
    "spinner",
  )
  act(() => {
    fireEvent.press(screen.getByText("Done"))
  })
  expect(onChange).toHaveBeenCalledWith("07:00")
})
