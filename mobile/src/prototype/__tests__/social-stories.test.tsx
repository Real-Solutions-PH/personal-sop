import { act, fireEvent, render, screen } from "@testing-library/react-native"
import type { ReactNode } from "react"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import {
  loadStoriesLive,
  refreshStory,
  type StoryItem,
  socialStore,
} from "../social/store"
import { LOAD_TIMEOUT_MS, StoryViewer } from "../social/stories"

const mockBack = jest.fn()
jest.mock("expo-router", () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: () => mockBack(),
    canGoBack: () => true,
  },
  usePathname: () => "/social/stories/ana",
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
  }),
}))
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: (props: object) => <View {...props} /> }
})
jest.mock("react-native-gesture-handler", () => {
  const chain: object = new Proxy({}, { get: () => () => chain })
  return {
    Gesture: chain,
    GestureDetector: ({ children }: { children: ReactNode }) => children,
  }
})
// A timing animation that really takes its duration, so the slide timer can
// be observed with fake timers; cancelling stops it. With the device's
// Reduce Motion setting on, Reanimated finishes an animation on its first
// frame unless its config opts out (``reduceMotion: "never"``).
const mockTimers = new Set<ReturnType<typeof setTimeout>>()
const mockMotion = { reduced: false }
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withSpring: (value: unknown) => value,
  useReducedMotion: () => true,
  ReduceMotion: { System: "system", Always: "always", Never: "never" },
  withTiming: (
    value: unknown,
    cfg?: { duration?: number; reduceMotion?: string },
    done?: (finished: boolean) => void,
  ) => {
    if (done) {
      const instant = mockMotion.reduced && cfg?.reduceMotion !== "never"
      const id = setTimeout(
        () => {
          mockTimers.delete(id)
          done(true)
        },
        instant ? 0 : (cfg?.duration ?? 0),
      )
      mockTimers.add(id)
    }
    return value
  },
  cancelAnimation: () => {
    for (const id of mockTimers) clearTimeout(id)
    mockTimers.clear()
  },
}))
jest.mock("../social/store", () => ({
  ...jest.requireActual("../social/store"),
  refreshStory: jest.fn(async () => "ok"),
  loadStoriesLive: jest.fn(async () => {}),
}))

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
}
const show = (id = "ana") =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <StoryViewer id={id} />
    </SafeAreaProvider>,
  )
const now = Date.now()
const story = (id: string, at: number): StoryItem => ({
  id,
  by: "ana",
  at,
  kind: "image",
  uri: `https://cdn/${id}.jpg`,
  mediaId: `m-${id}`,
})
const base = () => screen.getByTestId("remote-image-base")
const shownUri = () =>
  (base().props.source as { uri: string }).uri.replace("https://cdn/", "")
const loaded = () => act(() => base().props.onLoad())
const failed = () => act(async () => base().props.onError())

beforeEach(() => {
  mockMotion.reduced = false
  jest.useFakeTimers()
  jest.clearAllMocks()
  socialStore.set((s) => ({
    ...s,
    stories: [story("s1", now - 2000), story("s2", now - 1000)],
    seen: [],
  }))
})
afterEach(() => {
  jest.useRealTimers()
})

test("the timer does not run before the photo has loaded", () => {
  show()
  expect(shownUri()).toBe("s1.jpg")
  expect(screen.getByLabelText("Loading check-in")).toBeTruthy()
  act(() => jest.advanceTimersByTime(6000))
  expect(shownUri()).toBe("s1.jpg")
})

test("once loaded it plays its full 5 s, then moves on", () => {
  show()
  act(() => jest.advanceTimersByTime(3000))
  loaded()
  expect(screen.queryByLabelText("Loading check-in")).toBeNull()
  act(() => jest.advanceTimersByTime(4900))
  expect(shownUri()).toBe("s1.jpg")
  act(() => jest.advanceTimersByTime(200))
  expect(shownUri()).toBe("s2.jpg")
})

test("with Reduce Motion on, a slide still plays its full 5 s", () => {
  // The bar is a clock, not decoration: skipping it ran through every slide
  // and closed the viewer the moment it opened.
  mockMotion.reduced = true
  show()
  loaded()
  act(() => jest.advanceTimersByTime(4900))
  expect(shownUri()).toBe("s1.jpg")
  expect(mockBack).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(200))
  expect(shownUri()).toBe("s2.jpg")
})

test("a first failure re-reads the story and loads it again, quietly", async () => {
  show()
  await failed()
  expect(refreshStory).toHaveBeenCalledWith("s1")
  expect(screen.queryByText("Couldn't load this check-in")).toBeNull()
  expect(screen.getByLabelText("Loading check-in")).toBeTruthy()
})

test("a second failure shows Retry and Skip and does not move on", async () => {
  show()
  await failed()
  await failed()
  expect(screen.getByText("Couldn't load this check-in")).toBeTruthy()
  act(() => jest.advanceTimersByTime(20_000))
  expect(shownUri()).toBe("s1.jpg")
  fireEvent.press(screen.getByText("Skip"))
  expect(shownUri()).toBe("s2.jpg")
})

test("Retry loads the slide again", async () => {
  show()
  await failed()
  await failed()
  fireEvent.press(screen.getByText("Retry"))
  expect(screen.queryByText("Couldn't load this check-in")).toBeNull()
  loaded()
  act(() => jest.advanceTimersByTime(5100))
  expect(shownUri()).toBe("s2.jpg")
})

test("a slide not loaded within 15 s shows the error", () => {
  show()
  act(() => jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 10))
  expect(screen.getByText("Couldn't load this check-in")).toBeTruthy()
})

test("a person with no live check-ins: spinner, then an error toast and close", async () => {
  socialStore.set((s) => ({ ...s, stories: [] }))
  show("ana")
  expect(screen.getByLabelText("Loading")).toBeTruthy()
  await act(async () => {})
  expect(loadStoriesLive).toHaveBeenCalled()
  expect(toast.error).toHaveBeenCalledWith(
    "This check-in is no longer available",
  )
  expect(mockBack).toHaveBeenCalled()
})
