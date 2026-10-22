// The Account screen in prototype mode: the delete button stays disabled
// until the password and the confirm word are both in.
import { configureStorage } from "@domain/lib/store"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Account } from "../screens/account"
import { sessionStore } from "../session"

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
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
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

const deleteButton = () =>
  screen.getByRole("button", { name: "Delete my account" })

test("delete stays disabled until the password and DELETE are entered", async () => {
  const { router } = require("expo-router")
  render(<Account />, { wrapper })
  expect(screen.getByText("me@example.test")).toBeTruthy()
  fireEvent.press(screen.getByRole("button", { name: "Delete account" }))
  expect(deleteButton().props.accessibilityState?.disabled).toBe(true)
  fireEvent.changeText(screen.getByLabelText("Your password"), "Pass-word1")
  fireEvent.changeText(
    screen.getByLabelText("Type DELETE to confirm"),
    "delete",
  )
  expect(deleteButton().props.accessibilityState?.disabled).toBe(true)
  fireEvent.changeText(
    screen.getByLabelText("Type DELETE to confirm"),
    "DELETE",
  )
  expect(deleteButton().props.accessibilityState?.disabled).toBe(false)
  await act(async () => {
    fireEvent.press(deleteButton())
  })
  await waitFor(() => expect(sessionStore.get().signedIn).toBe(false))
  expect(router.replace).toHaveBeenCalledWith("/welcome")
})

test("change password shows the field errors before calling anything", () => {
  render(<Account />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Change password" }))
  fireEvent.changeText(screen.getByLabelText("New password"), "short")
  fireEvent.changeText(
    screen.getByLabelText("Confirm new password"),
    "different",
  )
  fireEvent.press(
    screen.getAllByRole("button", { name: "Change password" }).at(-1)!,
  )
  expect(screen.getByText("Enter your current password")).toBeTruthy()
  expect(
    screen.getByText("Use 8+ characters with letters, a number or a symbol"),
  ).toBeTruthy()
  expect(screen.getByText("Passwords don't match")).toBeTruthy()
})
