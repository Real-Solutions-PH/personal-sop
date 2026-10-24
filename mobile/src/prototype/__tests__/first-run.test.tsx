// First run: until onboarding is finished the app is onboarding and nothing
// else. Onboarding cannot be skipped or left, its last part is setup, and
// only finishing setup marks the person onboarded. "Run setup again" is
// setup alone.
import { dashStore } from "@domain/dash/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { syncReady } from "@/live/ready"
import { Onboarding } from "../screens/onboarding"
import { Setup } from "../screens/setup"

const params: { step?: string } = {}
let mockPath = "/today"
jest.mock("expo-router", () => {
  const { View } = require("react-native")
  const Stack = ({ children }: { children: ReactNode }) => (
    <View>{children}</View>
  )
  Stack.Screen = () => null
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      canGoBack: () => true,
    },
    useLocalSearchParams: () => params,
    usePathname: () => mockPath,
    Stack,
    Redirect: () => null,
  }
})
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  withRepeat: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
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
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }),
}))
jest.mock("../screens/capture", () => ({ CaptureOverlay: () => null }))
jest.mock("../wake-word-listener", () => ({ WakeWordListener: () => null }))
jest.mock("../local-reminders", () => ({ startReminders: () => () => {} }))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
}
const wrapper = ({ children }: { children: ReactNode }) => (
  <SafeAreaProvider initialMetrics={metrics}>{children}</SafeAreaProvider>
)
// One section turned on and empty, so setup has exactly one step to do.
function onlyHabits(onboarded: boolean) {
  dashStore.set((s) => ({
    ...s,
    onboarded,
    enabled: {
      habits: true,
      tasks: false,
      fitness: false,
      nutrition: false,
      focus: false,
      finance: false,
    },
  }))
  habitsStore.set((s) => ({ ...s, habits: [] }))
}
beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  jest.clearAllMocks()
  delete params.step
  mockPath = "/today"
})

describe("onboarding", () => {
  beforeEach(() => onlyHabits(false))

  test("has no Skip and no way out from its first step", () => {
    render(<Onboarding />, { wrapper })
    expect(screen.getByText("Your life, one dashboard")).toBeTruthy()
    expect(screen.queryByText("Skip")).toBeNull()
    expect(screen.queryByLabelText("Back")).toBeNull()
  })

  test("a later step goes back a step, never out of onboarding", () => {
    params.step = "modules"
    render(<Onboarding />, { wrapper })
    expect(screen.queryByText("Skip")).toBeNull()
    fireEvent.press(screen.getByLabelText("Back"))
    expect(screen.getByText("Who are you becoming?")).toBeTruthy()
    expect(router.push).not.toHaveBeenCalled()
    expect(router.replace).not.toHaveBeenCalled()
  })

  test("its last step leads into setup without finishing onboarding", () => {
    params.step = "done"
    render(<Onboarding />, { wrapper })
    expect(screen.queryByText("Go to Today")).toBeNull()
    fireEvent.press(screen.getByText("Set up my workspace"))
    expect(router.push).toHaveBeenCalledWith("/setup")
    expect(dashStore.get().onboarded).toBe(false)
  })

  test("someone already onboarded is sent on to Today", () => {
    onlyHabits(true)
    render(<Onboarding />, { wrapper })
    expect(router.replace).toHaveBeenCalledWith("/today")
  })
})

describe("setup", () => {
  test("during onboarding nothing can be skipped or left for later", () => {
    onlyHabits(false)
    render(<Setup />, { wrapper })
    expect(screen.queryByText("I'll finish later")).toBeNull()
    expect(screen.queryByLabelText("Close")).toBeNull()
    fireEvent.press(screen.getByText("Start"))
    expect(screen.queryByText("Skip")).toBeNull()
  })

  test("finishing it is what finishes onboarding", () => {
    onlyHabits(false)
    habitsStore.set((s) => ({
      ...s,
      habits: [{ id: "h1", name: "Read" } as never],
    }))
    render(<Setup />, { wrapper })
    fireEvent.press(screen.getByText("Go to Today"))
    expect(dashStore.get().onboarded).toBe(true)
    expect(router.replace).toHaveBeenCalledWith("/today")
  })

  test("run again later, it keeps its Skip and its way out", () => {
    onlyHabits(true)
    render(<Setup />, { wrapper })
    expect(screen.getByText("I'll finish later")).toBeTruthy()
    expect(screen.getByLabelText("Close")).toBeTruthy()
    fireEvent.press(screen.getByText("Start"))
    expect(screen.getByText("Skip")).toBeTruthy()
  })
})

describe("the app around it", () => {
  // Loaded after the mocks; the layout pulls in the whole tab bar.
  const Layout = () => {
    const Page = require("@/app/(sop)/_layout").default
    return <Page />
  }

  test("before onboarding is finished, every page sends you to it and the bar is gone", () => {
    onlyHabits(false)
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(router.replace).toHaveBeenCalledWith("/onboarding")
    expect(screen.queryByLabelText("Main navigation")).toBeNull()
  })

  test("waits for the first sync before deciding", () => {
    onlyHabits(false)
    syncReady.setState({ ready: false })
    render(<Layout />, { wrapper })
    expect(router.replace).not.toHaveBeenCalled()
  })

  test("once onboarded the bar is back and nothing redirects", () => {
    onlyHabits(true)
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Main navigation")).toBeTruthy()
  })
})
