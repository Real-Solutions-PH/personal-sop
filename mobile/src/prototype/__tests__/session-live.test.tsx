// Live mode: the sign-up username check asks the server, and completing
// sign-up waits for the server to accept the username before letting the
// person in.
import { dashStore } from "@domain/dash/store"
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
import { AccountForm, SignUp } from "../screens/auth-sign-up"
import {
  AuthError,
  checkUsername,
  chooseUsername,
  completeSignUp,
  sessionStore,
  signUp,
} from "../session"

jest.mock("@/live/config", () => ({
  liveMode: true,
  API_URL: "http://api.test",
  API_PREFIX: "/api/v1",
}))
const mockCheckHandle = jest.fn()
const mockCompleteProfile = jest.fn()
const mockSignUp = jest.fn()
jest.mock("@/live/auth", () => ({
  signUp: (...a: unknown[]) => mockSignUp(...a),
  checkHandle: (...a: unknown[]) => mockCheckHandle(...a),
  completeProfile: (...a: unknown[]) => mockCompleteProfile(...a),
  currentUserId: () => Promise.resolve("uid-1"),
  onSessionLost: () => {},
}))
const mockStartLive = jest.fn()
jest.mock("@/live/runtime", () => ({
  startLive: (...a: unknown[]) => mockStartLive(...a),
}))
jest.mock("../storage", () => ({
  prototypeStorage: () => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }),
}))
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 320, height: 640 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
const verified = { name: "New Person", username: "new.one", email: "n@x.io" }
const taken = () =>
  Object.assign(new Error("@new.one is already taken"), { field: "username" })

// The shared host runs several suites at once; renders can be slow.
jest.setTimeout(30000)

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  sessionStore.set((s) => ({
    ...s,
    signedIn: false,
    user: null,
    pending: { ...verified },
    claim: null,
  }))
  dashStore.set((d) => ({ ...d, profile: { ...d.profile, handle: "" } }))
  jest.clearAllMocks()
})

test("checkUsername asks the server, not the demo list", async () => {
  mockCheckHandle.mockResolvedValueOnce("available")
  // "kai" is on the prototype's taken list; live mode must not consult it.
  await expect(checkUsername("kai")).resolves.toBe("available")
  expect(mockCheckHandle).toHaveBeenCalledWith("kai")
  mockCheckHandle.mockResolvedValueOnce("taken")
  await expect(checkUsername("someone.else")).resolves.toBe("taken")
  mockCheckHandle.mockResolvedValueOnce("unknown")
  await expect(checkUsername("offline.case")).resolves.toBe("unknown")
})

test("completeSignUp waits for the server before signing the person in", async () => {
  let accept: () => void = () => {}
  mockCompleteProfile.mockReturnValueOnce(
    new Promise<void>((done) => {
      accept = done
    }),
  )
  const finishing = completeSignUp()
  await Promise.resolve()
  expect(mockCompleteProfile).toHaveBeenCalledWith("New Person", "new.one", {})
  expect(sessionStore.get().signedIn).toBe(false)
  expect(dashStore.get().profile.handle).toBe("")
  accept()
  await finishing
  expect(sessionStore.get()).toMatchObject({
    signedIn: true,
    pending: null,
    claim: null,
    user: { username: "new.one" },
  })
  expect(dashStore.get().profile.handle).toBe("@new.one")
  await waitFor(() => expect(mockStartLive).toHaveBeenCalled())
})

test("a username taken meanwhile is surfaced, never left unclaimed", async () => {
  mockCompleteProfile.mockRejectedValueOnce(taken())
  const failure = await completeSignUp().catch((e: unknown) => e)
  expect(failure).toBeInstanceOf(AuthError)
  expect((failure as AuthError).field).toBe("username")
  expect(sessionStore.get()).toMatchObject({
    signedIn: false,
    pending: null,
    claim: { username: "new.one" },
  })
  // The refused username is not written locally (sync would push it again).
  expect(dashStore.get().profile.handle).toBe("")
  expect(mockStartLive).not.toHaveBeenCalled()

  // The person picks another; that claim goes through.
  mockCompleteProfile.mockResolvedValueOnce(undefined)
  await chooseUsername("new.two")
  expect(mockCompleteProfile).toHaveBeenLastCalledWith(
    "New Person",
    "new.two",
    {},
  )
  expect(sessionStore.get()).toMatchObject({
    signedIn: true,
    claim: null,
    user: { username: "new.two" },
  })
  expect(dashStore.get().profile.handle).toBe("@new.two")
})

test("any other failure rejects and keeps the sign-up retryable", async () => {
  mockCompleteProfile.mockRejectedValueOnce(new Error("Could not finish"))
  await expect(completeSignUp()).rejects.toThrow("Could not finish")
  expect(sessionStore.get()).toMatchObject({
    signedIn: false,
    pending: { username: "new.one" },
    claim: null,
  })
  mockCompleteProfile.mockResolvedValueOnce(undefined)
  await completeSignUp()
  expect(sessionStore.get().signedIn).toBe(true)
})

test("an account the server confirms at sign-up is signed straight in", async () => {
  sessionStore.set((s) => ({ ...s, pending: null }))
  mockSignUp.mockResolvedValueOnce(true)
  mockCompleteProfile.mockResolvedValueOnce(undefined)
  await signUp({ ...verified, password: "long-enough-1" })
  expect(mockCompleteProfile).toHaveBeenCalledWith("New Person", "new.one", {})
  expect(sessionStore.get()).toMatchObject({
    signedIn: true,
    pending: null,
    user: { email: "n@x.io" },
  })
})

test("an account waiting for its emailed code stays pending", async () => {
  sessionStore.set((s) => ({ ...s, pending: null }))
  mockSignUp.mockResolvedValueOnce(false)
  await signUp({ ...verified, password: "long-enough-1" })
  expect(mockCompleteProfile).not.toHaveBeenCalled()
  expect(sessionStore.get()).toMatchObject({
    signedIn: false,
    pending: { email: "n@x.io" },
  })
})

describe("Sign up screen", () => {
  beforeEach(() => {
    sessionStore.set((s) => ({ ...s, pending: null }))
  })

  test("a check the server could not answer stays neutral", async () => {
    mockCheckHandle.mockResolvedValue("unknown")
    render(<AccountForm onBack={() => {}} />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Username"), "fresh.name")
    await waitFor(() =>
      expect(mockCheckHandle).toHaveBeenCalledWith("fresh.name"),
    )
    await act(() => Promise.resolve())
    expect(screen.queryByText("@fresh.name is available")).toBeNull()
    expect(screen.queryByText("@fresh.name is already taken")).toBeNull()
    expect(screen.getByText(/Friends find you by this/)).toBeTruthy()
  })

  test("a handle the server says is held shows the taken message", async () => {
    mockCheckHandle.mockResolvedValue("taken")
    render(<AccountForm onBack={() => {}} />, { wrapper })
    fireEvent.changeText(screen.getByLabelText("Username"), "held.name")
    expect(await screen.findByText("@held.name is already taken")).toBeTruthy()
  })

  test("a refused claim asks for another username, then lets the person in", async () => {
    sessionStore.set((s) => ({ ...s, claim: { ...verified } }))
    mockCheckHandle.mockImplementation(async (u: string) =>
      u === "new.one" ? "taken" : "available",
    )
    render(<SignUp />, { wrapper })
    expect(screen.getByText("Choose another username")).toBeTruthy()
    expect(screen.getByText("@new.one is already taken")).toBeTruthy()

    fireEvent.changeText(screen.getByLabelText("Username"), "new.two")
    expect(await screen.findByText("@new.two is available")).toBeTruthy()
    mockCompleteProfile.mockResolvedValueOnce(undefined)
    fireEvent.press(screen.getByRole("button", { name: "Continue" }))
    await waitFor(() => expect(sessionStore.get().signedIn).toBe(true))
    // No onboarding draft on this device: no about answers to send.
    expect(mockCompleteProfile).toHaveBeenCalledWith(
      "New Person",
      "new.two",
      {},
    )
    expect(require("expo-router").router.replace).toHaveBeenCalledWith(
      "/onboarding",
    )
  })
})
