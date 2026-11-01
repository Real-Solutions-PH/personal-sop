// Hide amounts is one saved setting: Today and Finance render the same eye
// button, which flips that setting and says so with a toast.
import { privacyStore } from "@domain/lib/privacy"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
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
  useAnimatedProps: (get: () => unknown) => get(),
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
jest.mock("expo-audio", () => ({}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))

const { FinanceHome } =
  require("../screens/finance-home") as typeof import("../screens/finance-home")
const { PrivacyEye } =
  require("../privacy-eye") as typeof import("../privacy-eye")

const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 44, left: 0, right: 0, bottom: 34 },
    }}
  >
    {children}
  </SafeAreaProvider>
)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
})

test("hiding amounts on Finance is the same switch as the eye on Today", () => {
  const fin = render(<FinanceHome />, { wrapper })
  expect(screen.queryAllByText("••••")).toHaveLength(0)
  fireEvent.press(screen.getByRole("button", { name: "Hide amounts" }))
  expect(privacyStore.get().hidden).toBe(true)
  // The amounts turning to dots is the confirmation: no toast.
  expect(toast).not.toHaveBeenCalled()
  expect(screen.queryAllByText("••••").length).toBeGreaterThan(0)
  fin.unmount()

  // Today's header renders this same button: it opens already hidden, and
  // showing amounts from it shows them on Finance again.
  const eye = render(<PrivacyEye />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Show amounts" }))
  expect(toast).not.toHaveBeenCalled()
  eye.unmount()
  render(<FinanceHome />, { wrapper })
  expect(screen.queryAllByText("••••")).toHaveLength(0)
  expect(screen.getByRole("button", { name: "Hide amounts" })).toBeTruthy()
})
