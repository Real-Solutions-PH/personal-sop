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

// Edit profile saves itself: a pause in typing writes the dash store once.
const pause = () => act(() => new Promise((r) => setTimeout(r, 700)))

test("a pause after an edit persists the dash store once, with no Save button", async () => {
  show()
  expect(screen.queryByText("Save")).toBeNull()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai No")
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai Noah")
  expect(dashWrites()).toHaveLength(0)
  await pause()
  expect(dashWrites()).toHaveLength(1)
  expect(dashStore.get().profile.name).toBe("Kai Noah")
  expect(screen.getByLabelText("Saved")).toBeTruthy()
  expect(mockRouter.back).not.toHaveBeenCalled()
  expect(toast.success).not.toHaveBeenCalled()
})

test("leaving mid-edit still saves what was typed", () => {
  const { unmount } = show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai Noah")
  unmount()
  expect(dashStore.get().profile.name).toBe("Kai Noah")
  expect(dashWrites()).toHaveLength(1)
})

test("the one write carries the photo file, never image data, and no photo work", async () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai Noah")
  await pause()
  const [write] = dashWrites()
  expect(write.value).toContain(FILE)
  expect(write.value).not.toContain("data:")
  expect(write.value.length).toBeLessThan(20_000)
  expect(pickAvatar).not.toHaveBeenCalled()
})

test("opening and leaving with no changes writes nothing", async () => {
  const { unmount } = show()
  await pause()
  unmount()
  expect(dashWrites()).toHaveLength(0)
})

test("the handle is lowercased with spaces stripped, rules shown inline", async () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Handle"), "Kai Noah")
  expect(screen.getByLabelText("Handle").props.value).toBe("kainoah")
  fireEvent.changeText(screen.getByLabelText("Handle"), "k!")
  expect(
    screen.getAllByText("Use at least 3 characters").length,
  ).toBeGreaterThan(0)
  fireEvent.changeText(screen.getByLabelText("Handle"), "")
  expect(
    screen.getAllByText("Use at least 3 characters").length,
  ).toBeGreaterThan(0)
  await pause()
  expect(dashWrites()).toHaveLength(0)
})

test("a taken handle is not saved; unknown (offline) is", async () => {
  jest.mocked(checkUsername).mockResolvedValueOnce("taken")
  show()
  fireEvent.changeText(screen.getByLabelText("Handle"), "ana.lifts")
  await waitFor(
    () => expect(screen.getByText("@ana.lifts is already taken")).toBeTruthy(),
    { timeout: 10_000 },
  )
  expect(screen.getByText("Handle taken")).toBeTruthy()
  await pause()
  expect(dashStore.get().profile.handle).toBe("@kai")

  jest.mocked(checkUsername).mockResolvedValueOnce("unknown")
  fireEvent.changeText(screen.getByLabelText("Handle"), "kai.offline")
  await act(() => new Promise((r) => setTimeout(r, 450)))
  await pause()
  expect(dashStore.get().profile.handle).toBe("@kai.offline")
})

test("the current handle is not checked", async () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "Kai N")
  await act(() => new Promise((r) => setTimeout(r, 450)))
  expect(checkUsername).not.toHaveBeenCalled()
})

test("a name under 2 characters shows an error and keeps the old name", async () => {
  show()
  fireEvent.changeText(screen.getByLabelText("Name"), "K")
  expect(screen.getAllByText("Enter your name").length).toBeGreaterThan(0)
  await pause()
  expect(dashStore.get().profile.name).toBe("Kai")
})
