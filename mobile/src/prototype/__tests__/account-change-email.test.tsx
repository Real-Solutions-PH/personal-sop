// The Account screen's Change email sheet in live mode: the change waits on
// a confirmation link, so the sheet says where the link went, and a link
// that could not be sent says that, not "Something went wrong".
import { configureStorage } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Account } from "../screens/account"
import { AuthError, sessionStore } from "../session"

jest.mock("@/live/config", () => ({
  ...jest.requireActual("@/live/config"),
  liveMode: true,
}))
const mockChangeEmail = jest.fn()
jest.mock("../session", () => ({
  ...jest.requireActual("../session"),
  changeEmail: (email: string) => mockChangeEmail(email),
}))
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
jest.mock("../media", () => ({
  exportCsv: jest.fn(),
  exportJson: jest.fn(() => Promise.resolve(true)),
  pickPhoto: jest.fn(),
}))
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
beforeEach(() => {
  mockChangeEmail.mockReset()
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  sessionStore.set((s) => ({
    ...s,
    signedIn: true,
    user: { name: "Kai", username: "kai", email: "me@example.test" },
  }))
})

async function send(address: string) {
  render(<Account />, { wrapper })
  fireEvent.press(screen.getByText("Email"))
  fireEvent.changeText(screen.getByLabelText("New email"), address)
  await act(async () => {
    fireEvent.press(
      screen.getByRole("button", { name: "Send confirmation link" }),
    )
  })
}

test("a sent link says where to look and that nothing changed yet", async () => {
  mockChangeEmail.mockResolvedValue(undefined)
  await send("New@Example.test")
  expect(mockChangeEmail).toHaveBeenCalledWith("New@Example.test")
  expect(screen.getByText("Check your inbox")).toBeTruthy()
  expect(screen.getByText("Confirmation sent to new@example.test")).toBeTruthy()
  expect(screen.getByText(/We also sent one to me@example\.test/)).toBeTruthy()
  expect(screen.getByText(/keep signing in with me@example\.test/)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Done" })).toBeTruthy()
})

test("a link that could not be sent shows why on the field", async () => {
  mockChangeEmail.mockRejectedValue(
    new AuthError(
      "We couldn't send the confirmation email to new@example.test, so your email hasn't changed. Try again later.",
      "email",
    ),
  )
  await send("new@example.test")
  expect(screen.getByText(/couldn't send the confirmation email/)).toBeTruthy()
  expect(screen.queryByText("Check your inbox")).toBeNull()
})
