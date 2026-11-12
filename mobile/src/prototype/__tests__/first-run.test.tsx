// First run: account first, then four short steps and one setup step.
// Until onboarding is finished the app is onboarding and nothing else; only
// finishing setup marks the person onboarded and queues the guided tour.
// "Run setup again" is setup alone.

import { captureStore } from "@domain/capture/store"
import { dashStore } from "@domain/dash/store"
import { focusStore } from "@domain/focus/store"
import { habitsStore } from "@domain/habits/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { syncReady } from "@/live/ready"
import { firstCaptureStore } from "../first-capture"
import { editDraft, getDraft } from "../onboarding-draft"
import { requestScreenTime } from "../screen-time"
import { Welcome } from "../screens/auth-welcome"
import { ONBOARDING_STEPS, Onboarding } from "../screens/onboarding"
import { Setup } from "../screens/setup"
import { sessionStore } from "../session"
import { FIRST_RUN_LIMIT, setSetupFirst } from "../setup-first"
import { tourOf } from "../tour/store"

const params: { step?: string; return?: string } = {}
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
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
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
  delete params.return
  mockPath = "/today"
  sessionStore.set((s) => ({ ...s, returning: false }))
})

describe("the account comes first", () => {
  beforeEach(() => onlyHabits(false))

  test("Welcome's Get started opens the account form, one tap first", () => {
    render(<Welcome />, { wrapper })
    fireEvent.press(screen.getByText("Get started"))
    expect(router.push).toHaveBeenCalledWith("/get-started")
    render(<Onboarding phase="pre" />, { wrapper })
    expect(screen.getByText("Create your account")).toBeTruthy()
    expect(screen.getByLabelText("Continue with Apple")).toBeTruthy()
    expect(screen.getByText("or with email")).toBeTruthy()
  })

  test("at most 8 screens before Today, with no forced waits", () => {
    // Welcome, account, the email code (only when the server asks), the
    // steps after the account, one setup step.
    expect(3 + 1 + ONBOARDING_STEPS.length).toBeLessThanOrEqual(8)
    expect(FIRST_RUN_LIMIT).toBe(1)
    expect(ONBOARDING_STEPS).not.toContain("building")
    expect(ONBOARDING_STEPS).not.toContain("pledge")
  })
})

describe("onboarding after the account exists", () => {
  beforeEach(() => onlyHabits(false))
  const open = () => render(<Onboarding />, { wrapper })

  test("starts at what to track, with no way out", () => {
    open()
    expect(screen.getByText("What do you want to track?")).toBeTruthy()
    expect(screen.getByLabelText("Step 1 of 4")).toBeTruthy()
    expect(screen.queryByLabelText("Back")).toBeNull()
    expect(screen.queryByText("Skip")).toBeNull()
  })

  test("the funnel records views, ticks, final choices and skips", () => {
    const F = require("../funnel") as typeof import("../funnel")
    F.setFunnelSender(async () => {})
    F.funnelStore.set({ installId: "", queue: [] })
    open()
    fireEvent.press(screen.getByText("Fitness"))
    fireEvent.press(screen.getByText("Journal"))
    fireEvent.press(screen.getByText("Next"))
    fireEvent.press(screen.getByText("Skip"))
    const q = F.funnelStore.get().queue.map(({ at: _at, ...e }) => e)
    expect(q).toEqual(
      expect.arrayContaining([
        { event: "step_view", step: "modules" },
        {
          event: "module_toggle",
          step: "modules",
          module: "journal",
          turned_on: true,
        },
        { event: "step_complete", step: "modules" },
        {
          event: "module_choice",
          step: "modules",
          module: "fitness",
          turned_on: true,
        },
        {
          event: "module_choice",
          step: "modules",
          module: "habits",
          turned_on: false,
        },
        { event: "step_view", step: "capture" },
        { event: "step_skip", step: "capture" },
        { event: "step_view", step: "about" },
      ]),
    )
    expect(q).not.toContainEqual({ event: "step_complete", step: "capture" })
    F.setFunnelSender(null)
  })

  test("the first capture is sent at once and answered on the same screen", () => {
    editDraft({ step: "capture" })
    open()
    expect(screen.getByText("Tell me one thing from today")).toBeTruthy()
    expect(screen.getByText("Say one thing first")).toBeTruthy()
    fireEvent.changeText(
      screen.getByLabelText("One thing from today"),
      "spent 250 on lunch",
    )
    fireEvent.press(screen.getByText("Log it"))
    const id = firstCaptureStore.get().sentId
    expect(id).not.toBeNull()
    expect(captureStore.get().captures.find((c) => c.id === id)?.text).toBe(
      "spent 250 on lunch",
    )
    // Fern's answer shows here, not after more screens.
    expect(screen.getByText("“spent 250 on lunch”")).toBeTruthy()
    fireEvent.press(screen.getByText("Next"))
    expect(getDraft()?.step).toBe("about")
  })

  test("skipping the first capture sends nothing", () => {
    editDraft({ step: "capture" })
    open()
    fireEvent.press(screen.getByText("Skip"))
    expect(firstCaptureStore.get().sentId).toBeNull()
    expect(getDraft()?.step).toBe("about")
  })

  test("the about step records both answers", () => {
    editDraft({ step: "about" })
    open()
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
      step: "when",
    })
  })

  test("skipping the about step leaves both answers empty", () => {
    editDraft({ step: "about", occupation: "student" })
    open()
    fireEvent.press(screen.getByText("Skip"))
    expect(screen.getByText("Set your pace")).toBeTruthy()
    expect(getDraft()).toMatchObject({ occupation: null, referralSource: null })
  })

  test("the last step writes the answers and leads into setup", () => {
    editDraft({
      step: "when",
      enabled: {
        habits: true,
        tasks: false,
        fitness: true,
        nutrition: false,
        focus: false,
        finance: false,
        screen: false,
      },
    })
    open()
    // Only promises the code keeps: no "three a day", no "Tap +".
    expect(screen.queryByText(/three a day/)).toBeNull()
    expect(screen.queryByText(/Tap \+/)).toBeNull()
    expect(screen.getByText(/at most one nudge a day/)).toBeTruthy()
    fireEvent.press(screen.getByText("Steady"))
    fireEvent.press(screen.getByText("Start my day"))
    expect(router.push).toHaveBeenCalledWith("/setup")
    expect(getDraft()).toBeNull()
    expect(dashStore.get().enabled.fitness).toBe(true)
    expect(dashStore.get().onboarded).toBe(false)
  })

  test("a reopened onboarding resumes at the saved step with its answers", () => {
    editDraft({ step: "about", occupation: "employed" })
    open().unmount()
    open()
    expect(screen.getByText("A little about you")).toBeTruthy()
    expect(getDraft()?.occupation).toBe("employed")
  })

  test("someone already onboarded is sent on to Today", () => {
    onlyHabits(true)
    open()
    expect(router.replace).toHaveBeenCalledWith("/today")
  })
})

describe("setup", () => {
  test("during onboarding it opens straight on the top step, the only one", () => {
    onlyHabits(false)
    dashStore.set((s) => ({
      ...s,
      enabled: { ...s.enabled, finance: true, fitness: true, focus: true },
    }))
    setSetupFirst(["focus", "habits", "finance", "fitness"])
    focusStore.set((s) => ({ ...s, sessions: [], settingsSaved: false }))
    render(<Setup />, { wrapper })
    expect(screen.getByText("Your daily focus goal")).toBeTruthy()
    expect(screen.getByTestId("setup-progress")).toBeTruthy()
    // Skipping it finishes onboarding; the rest wait for their first open,
    // and the guided tour waits for Today.
    fireEvent.press(screen.getByLabelText("Skip Focus setup"))
    expect(dashStore.get().onboarded).toBe(true)
    expect(dashStore.get().setupSkipped).toEqual(["focus"])
    expect(tourOf().queued).toBe(true)
    expect(router.replace).toHaveBeenCalledWith("/today")
  })

  test("during onboarding Back shows the list, which can be left for later", () => {
    onlyHabits(false)
    render(<Setup />, { wrapper })
    fireEvent.press(screen.getByLabelText("Back to setup"))
    expect(screen.getByText("Bring your life in")).toBeTruthy()
    // No way back into onboarding: its answers are already the account's.
    expect(screen.queryByLabelText("Back")).toBeNull()
    fireEvent.press(screen.getByText("I'll finish later"))
    expect(dashStore.get().onboarded).toBe(true)
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
    expect(tourOf().queued).toBe(false)
  })

  test("run again later, a step has a plain header with Back, no progress bar", () => {
    onlyHabits(true)
    render(<Setup />, { wrapper })
    fireEvent.press(screen.getByText("Start"))
    expect(screen.queryByTestId("setup-progress")).toBeNull()
    expect(screen.getByText("Set up Habits")).toBeTruthy()
    fireEvent.press(screen.getByLabelText("Back to setup"))
    expect(screen.getByText("Bring your life in")).toBeTruthy()
  })

  test("opened from a module's own screen, no progress bar; Back returns there", () => {
    onlyHabits(true)
    params.step = "habits"
    params.return = "/habits"
    render(<Setup />, { wrapper })
    expect(screen.getByText("A few starter habits")).toBeTruthy()
    expect(screen.queryByTestId("setup-progress")).toBeNull()
    expect(screen.getByText("Set up Habits")).toBeTruthy()
  })

  test("a module opened for the first time while still onboarding shows no progress bar either", () => {
    onlyHabits(false)
    params.step = "habits"
    params.return = "/habits"
    render(<Setup />, { wrapper })
    expect(screen.queryByTestId("setup-progress")).toBeNull()
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
  // First run opens straight on the step.
  const open = async () => {
    onlyScreen()
    render(<Setup />, { wrapper })
    await act(async () => {})
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
    expect(toast.warning).toHaveBeenCalledWith(
      "Screen Time access is off for Unfurl. Turn it on in Settings › Screen Time to track it.",
    )
  })

  test("leaving without connecting turns Screen time off", async () => {
    await open()
    fireEvent.press(screen.getByText("Not now"))
    expect(requestScreenTime).not.toHaveBeenCalled()
    expect(dashStore.get().enabled.screen).toBe(false)
    // Saying no is not a failure: nothing to report.
    expect(toast.warning).not.toHaveBeenCalled()
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

  test("answers in progress stay in the draft until onboarding's last step", () => {
    onlyHabits(false)
    editDraft({ step: "about", pushEvening: "20:30" })
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(getDraft()?.step).toBe("about")
    expect(dashStore.get().push.evening).not.toBe("20:30")
  })

  test("once onboarded the bar is back and nothing redirects", () => {
    onlyHabits(true)
    syncReady.setState({ ready: true })
    render(<Layout />, { wrapper })
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.getByLabelText("Main navigation")).toBeTruthy()
  })
})
