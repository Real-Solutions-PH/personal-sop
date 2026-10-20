import { configureStorage } from "@domain/lib/store"
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { SignIn } from "../screens/auth-sign-in"
import {
  checkUsername,
  completeSignUp,
  emailError,
  maskEmail,
  passwordStrength,
  sessionStore,
  signOut,
  signUp,
  verifyEmail,
} from "../session"

jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
  Redirect: () => null,
}))
jest.mock("react-native-reanimated", () => {
  // Layout animations are chainable builders: FadeInDown.delay(n).duration(n).
  const builder: object = new Proxy({}, { get: () => () => builder })
  const { Animated } = require("react-native")
  return {
    __esModule: true,
    default: Animated,
    useSharedValue: (value: unknown) =>
      require("react").useRef({ value }).current,
    useAnimatedStyle: (get: () => unknown) => get(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    withRepeat: (value: unknown) => value,
    withSequence: (...values: unknown[]) => values.at(-1),
    useReducedMotion: () => true,
    FadeIn: builder,
    FadeInDown: builder,
    ZoomIn: builder,
  }
})
jest.mock("expo-haptics", () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: "success", Error: "error" },
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
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
  signOut()
  sessionStore.set((s) => ({ ...s, rememberedEmail: "" }))
  jest.clearAllMocks()
})

test("validation helpers", () => {
  expect(emailError("")).toBe("Enter your email address")
  expect(emailError("kai@")).toMatch(/valid email/)
  expect(emailError(" kai@example.com ")).toBeUndefined()
  expect(passwordStrength("abc").acceptable).toBe(false)
  expect(passwordStrength("Sunrise2026").acceptable).toBe(true)
  expect(passwordStrength("Sunrise#2026!").score).toBe(4)
  expect(maskEmail("kairus@example.com")).toBe("ka••••@example.com")
})

test("sign in validates inline, shows the simulated error, then signs in", async () => {
  render(<SignIn />, { wrapper })
  fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
  expect(screen.getByText("Enter your email address")).toBeTruthy()
  expect(screen.getByText("Enter your password")).toBeTruthy()
  expect(sessionStore.get().signedIn).toBe(false)

  fireEvent.changeText(screen.getByLabelText("Email"), "kai@example.com")
  fireEvent.changeText(screen.getByLabelText("Password"), "wrong")
  fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
  expect(
    await screen.findByText("Incorrect email or password", undefined, {
      timeout: 2000,
    }),
  ).toBeTruthy()
  expect(sessionStore.get().signedIn).toBe(false)

  fireEvent.changeText(screen.getByLabelText("Password"), "Sunrise2026")
  fireEvent.press(screen.getByRole("button", { name: "Sign in" }))
  await waitFor(() => expect(sessionStore.get().signedIn).toBe(true), {
    timeout: 2000,
  })
  expect(sessionStore.get().user?.email).toBe("kai@example.com")
  expect(sessionStore.get().rememberedEmail).toBe("kai@example.com")
  expect(router.replace).toHaveBeenCalledWith("/today")
})

test("sign up rejects a registered email and verifies any code but 000000", async () => {
  const account = {
    name: "Kai",
    username: "kai.new",
    password: "Sunrise2026",
  }
  await expect(
    signUp({ ...account, email: "taken@example.com" }),
  ).rejects.toThrow(/already exists/)
  await signUp({ ...account, email: "Kai@Example.com" })
  expect(sessionStore.get().pending?.email).toBe("kai@example.com")
  await expect(verifyEmail("000000")).rejects.toThrow(/incorrect/)
  await verifyEmail("123456")
  expect(sessionStore.get().signedIn).toBe(false)
  await completeSignUp()
  expect(sessionStore.get()).toMatchObject({
    signedIn: true,
    pending: null,
    claim: null,
    user: { username: "kai.new" },
  })
})

test("prototype mode checks usernames against the demo list", async () => {
  await expect(checkUsername("kai")).resolves.toBe("taken")
  await expect(checkUsername("admin")).resolves.toBe("taken")
  await expect(checkUsername("kai.new")).resolves.toBe("available")
})
