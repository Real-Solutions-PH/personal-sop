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

// The viewer's frame in these tests: jest's 750-wide window, capped at 520,
// and 520 × 16/9 tall.
const FRAME = { width: 520, height: (520 * 16) / 9 }
const box = () => {
  const style = screen.getByTestId("story-photo-box").props.style
  const photo = screen.getByLabelText("Story photo").props.style
  return {
    left: style.left as number,
    top: style.top as number,
    width: photo.width as number,
    height: photo.height as number,
    fit: base().props.contentFit as string,
  }
}
const expectWholeAndCentred = (ratio: number) => {
  const b = box()
  expect(b.fit).toBe("contain")
  expect(b.width / b.height).toBeCloseTo(ratio)
  expect(b.left).toBeGreaterThanOrEqual(0)
  expect(b.left + b.width).toBeLessThanOrEqual(FRAME.width + 0.01)
  expect(b.left).toBeCloseTo((FRAME.width - b.width) / 2)
  expect(b.top).toBeCloseTo((FRAME.height - b.height) / 2)
  // Clear of the progress bars, avatar, name, time and close button.
  expect(b.top).toBeGreaterThanOrEqual(64)
}

test("a share card posted at 4:5 plays whole and centred, not cropped to the frame", () => {
  socialStore.set((s) => ({
    ...s,
    stories: [{ ...story("card", now - 1000), ratio: 4 / 5 }],
  }))
  show()
  expectWholeAndCentred(4 / 5)
})

test("a photo of unknown shape is fitted once its size is read", () => {
  socialStore.set((s) => ({ ...s, stories: [story("card", now - 1000)] }))
  show()
  act(() => base().props.onLoad({ source: { width: 1080, height: 1350 } }))
  expectWholeAndCentred(4 / 5)
})

test("a story-shaped photo still fills the frame", () => {
  socialStore.set((s) => ({
    ...s,
    stories: [{ ...story("tall", now - 1000), ratio: 9 / 16 }],
  }))
  show()
  expect(box()).toMatchObject({ fit: "cover", left: 0, top: 0, width: 520 })
})

test("opening someone not in the tray never plays another person's check-ins", async () => {
  show("ben")
  await act(async () => {})
  expect(screen.queryByTestId("remote-image-base")).toBeNull()
  expect(socialStore.get().seen).not.toContain("s1")
  expect(toast.error).toHaveBeenCalledWith(
    "This check-in is no longer available",
  )
  expect(mockBack).toHaveBeenCalled()
})

test("when the open person's check-ins go away, the viewer moves on instead of a dark screen", () => {
  show("ana")
  loaded()
  act(() => socialStore.set((s) => ({ ...s, stories: [] })))
  expect(mockBack).toHaveBeenCalled()
})

test("the empty viewer always has a close button", () => {
  socialStore.set((s) => ({ ...s, stories: [] }))
  show("ana")
  fireEvent.press(screen.getByLabelText("Close stories"))
  expect(mockBack).toHaveBeenCalled()
})
