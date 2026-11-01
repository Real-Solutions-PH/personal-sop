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
import { toast } from "sonner-native"
import { pickAvatar } from "../media"
import { Profile } from "../screens/dash-profile"
import { checkUsername } from "../session"

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: () => true,
}
jest.mock("expo-router", () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: () => mockRouter.back(),
    canGoBack: () => mockRouter.canGoBack(),
  },
  usePathname: () => "/me/profile",
}))
// A busy machine needs more than 5 s for the first render.
jest.setTimeout(60_000)
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
}))
jest.mock("../media", () => ({
  ...jest.requireActual("../media"),
  pickAvatar: jest.fn(),
  pickPhoto: jest.fn(),
}))
jest.mock("../session", () => ({
  ...jest.requireActual("../session"),
  checkUsername: jest.fn(async () => "available"),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <Profile />
    </SafeAreaProvider>,
  )
const writes: { key: string; value: string }[] = []
const dashWrites = () => writes.filter((w) => w.key === "sop-proto:dash")
const FILE = "file:///app/avatar/1.jpg"

beforeEach(() => {
  jest.clearAllMocks()
  dashStore.set((s) => ({
    ...s,
    profile: { ...s.profile, name: "Kai", handle: "@kai", photo: FILE },
  }))
  writes.length = 0
  configureStorage({
    getItem: () => null,
    setItem: (key, value) => void writes.push({ key, value }),
    removeItem: () => {},
  })
})

test("Save persists the dash store once and goes back to Me", () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai Noah")
  fireEvent.press(screen.getByText("Save"))
  expect(dashWrites()).toHaveLength(1)
  expect(dashStore.get().profile.name).toBe("Kai Noah")
  expect(mockRouter.back).toHaveBeenCalledTimes(1)
  expect(mockRouter.push).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

test("the one write carries the photo file, never image data, and no photo work", () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai Noah")
  fireEvent.press(screen.getByText("Save"))
  const [write] = dashWrites()
  expect(write.value).toContain(FILE)
  expect(write.value).not.toContain("data:")
  expect(write.value.length).toBeLessThan(20_000)
  expect(pickAvatar).not.toHaveBeenCalled()
})

test("Save with no changes writes nothing and goes back", () => {
  show()
  fireEvent.press(screen.getByText("Save"))
  expect(dashWrites()).toHaveLength(0)
  expect(mockRouter.back).toHaveBeenCalledTimes(1)
})

test("the handle is lowercased with spaces stripped, rules shown inline", () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Handle"), "Kai Noah")
  expect(screen.getByLabelText("Handle").props.value).toBe("kainoah")
  fireEvent.changeText(screen.getByLabelText("Handle"), "k!")
  expect(screen.getByText("Use at least 3 characters")).toBeTruthy()
  fireEvent.changeText(screen.getByLabelText("Handle"), "")
  expect(screen.getByText("Use at least 3 characters")).toBeTruthy()
  fireEvent.press(screen.getByText("Save"))
  expect(dashWrites()).toHaveLength(0)
  expect(mockRouter.back).not.toHaveBeenCalled()
})

test("a taken handle disables Save; unknown (offline) allows it", async () => {
  jest.mocked(checkUsername).mockResolvedValueOnce("taken")
  show()
  fireEvent.changeText(screen.getByLabelText("Handle"), "ana.lifts")
  await waitFor(
    () => expect(screen.getByText("@ana.lifts is already taken")).toBeTruthy(),
    { timeout: 10_000 },
  )
  fireEvent.press(screen.getByText("Save"))
  expect(mockRouter.back).not.toHaveBeenCalled()

  jest.mocked(checkUsername).mockResolvedValueOnce("unknown")
  fireEvent.changeText(screen.getByLabelText("Handle"), "kai.offline")
  await act(() => new Promise((r) => setTimeout(r, 450)))
  fireEvent.press(screen.getByText("Save"))
  expect(dashStore.get().profile.handle).toBe("@kai.offline")
  expect(mockRouter.back).toHaveBeenCalledTimes(1)
})

test("the current handle is not checked", async () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai N")
  await act(() => new Promise((r) => setTimeout(r, 450)))
  expect(checkUsername).not.toHaveBeenCalled()
})

test("a name under 2 characters shows an error and keeps the old name", () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "K")
  expect(screen.getByText("Enter your name")).toBeTruthy()
  fireEvent.press(screen.getByText("Save"))
  expect(dashStore.get().profile.name).toBe("Kai")
})
