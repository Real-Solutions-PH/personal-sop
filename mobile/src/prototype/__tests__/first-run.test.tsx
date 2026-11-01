// First run: until onboarding is finished the app is onboarding and nothing
// else. Onboarding cannot be skipped or left, its last part is setup, and
// only finishing setup marks the person onboarded. "Run setup again" is
// setup alone.
import { dashStore } from "@domain/dash/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { syncReady } from "@/live/ready"
import { editDraft, getDraft } from "../onboarding-draft"
import { requestScreenTime } from "../screen-time"
import { Welcome } from "../screens/auth-welcome"
import { Onboarding } from "../screens/onboarding"
import { Setup } from "../screens/setup"
import { sessionStore } from "../session"

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
jest.mock("../screen-time", () => ({
  screenTimeAvailable: jest.fn(() => true),
  authorizationStatus: jest.fn(async () => "notDetermined"),
  requestScreenTime: jest.fn(async () => "approved"),
  hasSelection: jest.fn(async () => false),
  startMonitoring: jest.fn(async () => {}),
  stopMonitoring: jest.fn(async () => {}),
  readEvents: jest.fn(async () => []),
}))

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
      screen: false,
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
  sessionStore.set((s) => ({ ...s, returning: false }))
})

describe("onboarding before the account exists", () => {
  beforeEach(() => onlyHabits(false))
  const pre = () => render(<Onboarding phase="pre" />, { wrapper })

  test("Welcome's Get started opens identity, not a sign-up form", () => {
    render(<Welcome />, { wrapper })
    fireEvent.press(screen.getByText("Get started"))
    expect(router.push).toHaveBeenCalledWith("/get-started")
    pre()
    expect(screen.getByText("Who are you becoming?")).toBeTruthy()
    expect(screen.queryByText("Create your account")).toBeNull()
    expect(getDraft()?.step).toBe("identity")
  })

  test("every step offers Sign in; the draft is kept for Back", () => {
    pre()
    for (const label of ["“I show up every day”", "That's me"])
      fireEvent.press(screen.getByText(label))
    fireEvent.press(screen.getByLabelText("I already have an account"))
    expect(router.push).toHaveBeenCalledWith("/login")
    expect(getDraft()).toMatchObject({
      step: "about",
      identities: ["I show up every day"],
    })
  })

  test("the about step records both answers", () => {
    editDraft({ step: "about" })
    pre()
    fireEvent.press(screen.getByText("Student"))
    fireEvent.changeText(
      screen.getByLabelText("Field of study or line of work"),
      "Nursing",
    )
    fireEvent.press(screen.getByText("TikTok"))
    // Only "A friend" and "Other" ask for more.
    expect(screen.queryByLabelText("Who told you? (optional)")).toBeNull()
    fireEvent.press(screen.getByText("Continue"))
    expect(getDraft()).toMatchObject({
      occupation: "student",
      occupationDetail: "Nursing",
      referralSource: "tiktok",
      step: "modules",
    })
  })

  test("skipping the about step leaves both answers empty", () => {
    editDraft({ step: "about" })
    pre()
    fireEvent.press(screen.getByText("Skip"))
    expect(screen.getByText("What do you want to track?")).toBeTruthy()
    expect(getDraft()).toMatchObject({ occupation: null, referralSource: null })
  })

  test("every feature starts selected but Screen time, which only records the choice", () => {
    editDraft({ step: "modules" })
    pre()
    const enabled = getDraft()!.enabled
    expect(Object.entries(enabled).filter(([, on]) => !on)).toEqual([
      ["screen", false],
    ])
    expect(screen.getByText("Needs Screen Time access")).toBeTruthy()
    fireEvent.press(screen.getByText("Screen time"))
    expect(getDraft()?.enabled.screen).toBe(true)
    expect(requestScreenTime).not.toHaveBeenCalled()
    // Nothing is written to the device's account data before sign-up.
    expect(dashStore.get().enabled.fitness).toBe(false)
  })

  test("a reopened onboarding resumes at the saved step with its answers", () => {
    editDraft({ step: "targets", identities: ["I finish what I start"] })
    const first = pre()
    first.unmount()
    pre()
    expect(screen.getByText("Pick your pace")).toBeTruthy()
    expect(getDraft()?.identities).toEqual(["I finish what I start"])
  })

  test("the pledge leads to the account step, and back returns to it", () => {
    editDraft({ step: "account" })
    pre()
    expect(screen.getByText("Create your account")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Back"))
    expect(getDraft()?.step).toBe("pledge")
  })
})

describe("onboarding after the account exists", () => {
  beforeEach(() => onlyHabits(false))

  test("starts at the notification ask, with no way out", () => {
    render(<Onboarding />, { wrapper })
    expect(screen.getByText("Protect your plan")).toBeTruthy()
    expect(screen.queryByText("Skip")).toBeNull()
    expect(screen.queryByLabelText("Back")).toBeNull()
    expect(screen.queryByLabelText("I already have an account")).toBeNull()
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

describe("setup's Screen time step", () => {
  // Screen time on from the onboarding draft, nothing else to set up.
  function onlyScreen() {
    dashStore.set((s) => ({
      ...s,
      onboarded: false,
      enabled: {
        habits: false,
        tasks: false,
        fitness: false,
        nutrition: false,
        focus: false,
        finance: false,
        screen: true,
      },
    }))
  }
  const open = async () => {
    onlyScreen()
    render(<Setup />, { wrapper })
    await act(async () => {})
    fireEvent.press(screen.getByText("Start"))
  }

  test("Connect asks for the permission; approved keeps Screen time on", async () => {
    await open()
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Connect Screen Time" }),
      )
    })
    expect(requestScreenTime).toHaveBeenCalledTimes(1)
    expect(dashStore.get().enabled.screen).toBe(true)
  })

  test("a deny turns Screen time off and says so", async () => {
    jest.mocked(requestScreenTime).mockResolvedValueOnce("denied")
    await open()
    await act(async () => {
      fireEvent.press(
        screen.getByRole("button", { name: "Connect Screen Time" }),
      )
    })
    expect(dashStore.get().enabled.screen).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      "Screen Time access is off for Unfurl. Turn it on in Settings › Screen Time to track it.",
    )
  })

  test("leaving without connecting turns Screen time off", async () => {
    await open()
    fireEvent.press(screen.getByText("Not now"))
    expect(requestScreenTime).not.toHaveBeenCalled()
    expect(dashStore.get().enabled.screen).toBe(false)
    expect(toast).toHaveBeenCalledWith(
      "Screen time is off. Turn it on anytime in Settings.",
    )
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

  test("an existing account that never finished onboarding is not sent to it", () => {
    onlyHabits(false)
    sessionStore.set((s) => ({ ...s, returning: true }))
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(router.replace).not.toHaveBeenCalledWith("/onboarding")
    expect(dashStore.get().onboarded).toBe(true)
  })

  test("a new account's unapplied onboarding answers are applied once", () => {
    onlyHabits(false)
    editDraft({ identities: ["I ship"], pushMorning: "06:30" })
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(getDraft()).toBeNull()
    expect(dashStore.get().push.morning).toBe("06:30")
    expect(dashStore.get().profile.identities.map((i) => i.text)).toEqual([
      "I ship",
    ])
  })

  test("once onboarded the bar is back and nothing redirects", () => {
    onlyHabits(true)
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Main navigation")).toBeTruthy()
  })
})
