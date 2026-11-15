// Battery: clocks tick only for what is on screen, at the rate it needs,
// and the idle signals behind Fern's rest and "Hey Fern" standing down.

import { liveStore } from "@domain/lib/live"
import { act, render } from "@testing-library/react-native"
import { AppState, type AppStateStatus, Text } from "react-native"
import { LiveBar } from "../live-bar"
import { noteActivity, useIdle } from "../on-screen"
import { useNow } from "../ui"

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
  interpolateColor: (_: number, __: number[], output: string[]) => output[0],
  runOnJS: (fn: unknown) => fn,
  useReducedMotion: () => true,
}))
jest.mock("sonner-native", () => ({
  toast: Object.assign(jest.fn(), { error: jest.fn(), warning: jest.fn() }),
}))
jest.mock("../navigation", () => ({ go: jest.fn(), replace: jest.fn() }))
jest.mock("@/surfaces/actions", () => ({ applySurfaceAction: jest.fn() }))
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Light: "light" },
}))
// A screen's navigation object the test can focus and blur.
const mockNav = {
  focused: true,
  listeners: new Map<string, Set<() => void>>(),
  isFocused() {
    return this.focused
  },
  addListener(type: string, l: () => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(l)
    this.listeners.set(type, set)
    return () => set.delete(l)
  },
  emit(type: "focus" | "blur") {
    this.focused = type === "focus"
    for (const l of this.listeners.get(type) ?? []) l()
  },
}
let mockInNavigator = false
jest.mock("expo-router", () => ({
  useNavigation: () => {
    if (!mockInNavigator) throw new Error("no navigator")
    return mockNav
  },
}))

const appListeners = new Set<(s: AppStateStatus) => void>()
let spy: jest.SpyInstance
const setApp = (s: AppStateStatus) =>
  act(() => {
    ;(AppState as { currentState: AppStateStatus }).currentState = s
    for (const l of [...appListeners]) l(s)
  })

beforeEach(() => {
  jest.useFakeTimers()
  mockInNavigator = false
  mockNav.focused = true
  mockNav.listeners.clear()
  ;(AppState as { currentState: AppStateStatus }).currentState = "active"
  spy = jest.spyOn(AppState, "addEventListener").mockImplementation((_t, l) => {
    const fn = l as (s: AppStateStatus) => void
    appListeners.add(fn)
    return { remove: () => void appListeners.delete(fn) }
  })
})
afterEach(() => {
  spy.mockRestore()
  appListeners.clear()
  jest.useRealTimers()
})

/** One act per second, so each tick renders on its own. */
const seconds = (n: number) => {
  for (let i = 0; i < n; i++) act(() => jest.advanceTimersByTime(1000))
}

function Clock({
  every,
  renders,
}: {
  every: number | null
  renders: { n: number }
}) {
  const now = useNow(every)
  renders.n++
  return <Text>{now}</Text>
}

test("a one-second clock stops in the background and catches up on return", () => {
  const renders = { n: 0 }
  render(<Clock every={1000} renders={renders} />)
  const base = renders.n
  seconds(10)
  expect(renders.n - base).toBe(10)
  setApp("background")
  const parked = renders.n
  expect(jest.getTimerCount()).toBe(0)
  act(() => jest.advanceTimersByTime(60_000))
  expect(renders.n).toBe(parked) // no ticks while away
  setApp("active")
  // One catch-up render, then the clock runs again.
  expect(renders.n).toBeGreaterThan(parked)
  const back = renders.n
  seconds(3)
  expect(renders.n - back).toBe(3)
})

test("a Control Center glance (inactive) keeps the clock running", () => {
  const renders = { n: 0 }
  render(<Clock every={1000} renders={renders} />)
  setApp("inactive")
  const before = renders.n
  seconds(5)
  expect(renders.n - before).toBe(5)
})

test("a clock on a covered screen (tab left behind) stops until it is focused", () => {
  mockInNavigator = true
  const renders = { n: 0 }
  render(<Clock every={1000} renders={renders} />)
  act(() => mockNav.emit("blur"))
  const parked = renders.n
  expect(jest.getTimerCount()).toBe(0)
  act(() => jest.advanceTimersByTime(30_000))
  expect(renders.n).toBe(parked)
  act(() => mockNav.emit("focus"))
  const back = renders.n
  expect(back).toBeGreaterThan(parked) // caught up at once
  seconds(2)
  expect(renders.n - back).toBe(2)
})

test("useNow(null) never ticks", () => {
  const renders = { n: 0 }
  render(<Clock every={null} renders={renders} />)
  const base = renders.n
  expect(jest.getTimerCount()).toBe(0)
  act(() => jest.advanceTimersByTime(60_000))
  expect(renders.n).toBe(base)
})

test("the Live bar sets no timer while nothing runs, and ticks once something does", () => {
  act(() => liveStore.set({ live: null }))
  render(<LiveBar path="/today" />)
  expect(jest.getTimerCount()).toBe(0)
  act(() =>
    liveStore.set({
      live: {
        kind: "timer",
        label: "Read",
        href: "/habits/h1/timer",
        startedAt: new Date(Date.now()).toISOString(),
      } as never,
    }),
  )
  expect(jest.getTimerCount()).toBe(1)
  act(() => liveStore.set({ live: null }))
  expect(jest.getTimerCount()).toBe(0)
})

function Idle({ ms, seen }: { ms: number; seen: boolean[] }) {
  seen.push(useIdle(ms))
  return null
}

test("idle after the wait with no touch; a touch wakes it and restarts the wait", () => {
  act(() => noteActivity())
  const seen: boolean[] = []
  render(<Idle ms={20_000} seen={seen} />)
  act(() => jest.advanceTimersByTime(19_000))
  expect(seen.at(-1)).toBe(false)
  act(() => noteActivity())
  act(() => jest.advanceTimersByTime(19_000))
  expect(seen.at(-1)).toBe(false) // the touch pushed the deadline back
  seconds(2)
  expect(seen.at(-1)).toBe(true)
  // Resting: no timer left running.
  expect(jest.getTimerCount()).toBe(0)
  act(() => noteActivity())
  expect(seen.at(-1)).toBe(false)
  // Back to the foreground counts as activity too.
  act(() => jest.advanceTimersByTime(21_000))
  expect(seen.at(-1)).toBe(true)
  setApp("active")
  expect(seen.at(-1)).toBe(false)
})
