// Fern logged into a module switched off: the reply says it won't show on
// Today and offers to turn it on; the capture screen's card does the same.
// Turning it on lands in place, and the line says so.
import type { Capture, InfoCard } from "@domain/capture/data"
import { dashStore, setEnabled } from "@domain/dash/store"
import { configureStorage, resetAll } from "@domain/lib/store"
import { fireEvent, render, screen } from "@testing-library/react-native"
import { BlockView } from "../companion/blocks"
import { extrasStore, setShown } from "../extras"
import { Reply } from "../screens/capture"

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
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-audio", () => ({
  AudioModule: { requestRecordingPermissionsAsync: jest.fn() },
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(),
  useAudioRecorder: () => ({}),
  useAudioRecorderState: () => ({}),
}))
jest.mock("../media", () => ({ exportCsv: jest.fn(), pickPhoto: jest.fn() }))
const mockPush = jest.fn()
jest.mock("expo-router", () => ({
  router: { push: mockPush, replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => "/",
}))

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockPush.mockClear()
  setEnabled("finance", false)
})

test("Fern's line under a write into an off module turns it back on", () => {
  render(
    <BlockView
      block={{
        t: "module_off",
        module: "finance",
        text: "Finance is off, so this won't show on Today. Turn it on?",
      }}
    />,
  )
  expect(
    screen.getByText(
      "Finance is off, so this won't show on Today. Turn it on?",
    ),
  ).toBeTruthy()
  fireEvent.press(screen.getByText("Turn on Finance"))
  expect(dashStore.get().enabled.finance).toBe(true)
  expect(
    screen.getByText("Finance is on. It shows on Today again."),
  ).toBeTruthy()
  expect(screen.queryByText("Turn on Finance")).toBeNull()
})

test("the capture card's Turn on switches in place, not through the link", () => {
  const item: InfoCard = {
    t: "info",
    id: "r1",
    tone: "module_off",
    title: "Finance is off",
    body: "Saved, but it won't show on Today while it's off.",
    actions: [
      {
        label: "Turn on Finance",
        do: "module_on",
        module: "finance",
        href: "/me/settings",
      },
    ],
  }
  render(<Reply item={item} capture={{ id: "c1" } as Capture} />)
  fireEvent.press(screen.getByText("Turn on Finance"))
  expect(dashStore.get().enabled.finance).toBe(true)
  expect(mockPush).not.toHaveBeenCalled()
  expect(
    screen.getByText("Finance is on. It shows on Today again."),
  ).toBeTruthy()
})

test("after Not for me, Fern's line no longer asks", () => {
  render(
    <BlockView
      block={{
        t: "module_off",
        module: "finance",
        text: "Finance is off, so this won't show on Today.",
        ask: false,
      }}
    />,
  )
  expect(
    screen.getByText("Finance is off, so this won't show on Today."),
  ).toBeTruthy()
  expect(screen.queryByText("Turn on Finance")).toBeNull()
})

describe("Fern's one-time offer to bring back a hidden part", () => {
  const offer = (module: string) =>
    render(
      <BlockView
        block={{ t: "module_intro", module, text: `${module} is hidden.` }}
      />,
    )

  test("Turn on shows the Journal again, and says so", () => {
    setShown("journal", false)
    offer("journal")
    fireEvent.press(screen.getByText("Turn on Journal"))
    expect(extrasStore.get().journal).toBe(true)
    expect(
      screen.getByText("Journal is on. It shows on Today again."),
    ).toBeTruthy()
  })

  test("Not for me is kept on the account and acknowledged", () => {
    offer("finance")
    fireEvent.press(screen.getByText("Not for me"))
    expect(dashStore.get().intro.dismissed).toEqual(["finance"])
    expect(dashStore.get().enabled.finance).toBe(false)
    expect(
      screen.getByText("Got it. I won't bring up Finance again."),
    ).toBeTruthy()
  })

  test("an unknown part draws nothing", () => {
    offer("weather")
    expect(screen.queryByText("Not for me")).toBeNull()
  })
})
