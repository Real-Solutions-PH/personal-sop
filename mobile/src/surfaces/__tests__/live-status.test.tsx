// The run screens say when the lock-screen activity cannot show, and offer
// Settings when the person has turned it off. The status comes from the
// native module as JSON; anything else is treated as "cannot tell".
import { act, fireEvent, render, screen } from "@testing-library/react-native"
import { AppState, type AppStateStatus, Linking } from "react-native"
import type { LiveStatus } from "../native"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("@/prototype/__tests__/reanimated-extras").extras,
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

describe("liveStatus", () => {
  const load = (module: unknown) => {
    let mod: typeof import("../native") | undefined
    jest.isolateModules(() => {
      jest.doMock("expo", () => ({ requireOptionalNativeModule: () => module }))
      // The real module: LiveNotice's tests below mock it.
      mod = jest.requireActual("../native")
    })
    if (!mod) throw new Error("not loaded")
    return mod.liveStatus()
  }
  afterEach(() => jest.dontMock("expo"))

  it("reads enabled and the reason the last start failed", () => {
    expect(load({ liveStatus: () => '{"enabled":true}' })).toEqual({
      enabled: true,
    })
    expect(
      load({ liveStatus: () => '{"enabled":false,"error":"disabled"}' }),
    ).toEqual({ enabled: false, error: "disabled" })
  })

  it("is null without the module, on a build without the call, or on junk", () => {
    expect(load(null)).toBeNull()
    expect(load({ setLive: () => {} })).toBeNull()
    expect(load({ liveStatus: () => "not json" })).toBeNull()
    expect(load({ liveStatus: () => '{"enabled":"yes"}' })).toBeNull()
    expect(load({ liveStatus: () => "null" })).toBeNull()
  })
})

describe("LiveNotice", () => {
  let mockStatus: LiveStatus | null = null
  jest.doMock("../native", () => ({ liveStatus: () => mockStatus }))
  const { LiveNotice } =
    require("../live-notice") as typeof import("../live-notice")

  // Swapped by hand: AppState.addEventListener is already a mock under
  // jest-expo, and restoring a spy on it would wipe its implementation.
  const original = AppState.addEventListener
  let onChange: ((s: AppStateStatus) => void) | undefined
  beforeEach(() => {
    jest.useFakeTimers()
    onChange = undefined
    AppState.addEventListener = ((_t: string, h: typeof onChange) => {
      onChange = h
      return { remove: () => {} }
    }) as unknown as typeof AppState.addEventListener
  })
  afterEach(() => {
    jest.useRealTimers()
    AppState.addEventListener = original
  })
  const notice = () => screen.queryByText(/are off|Couldn't show this/)

  it("says nothing while the activity can show, or when the build cannot tell", () => {
    mockStatus = { enabled: true }
    render(<LiveNotice active accent="hab" />)
    expect(notice()).toBeNull()
    mockStatus = null
    act(() => jest.advanceTimersByTime(2000))
    expect(notice()).toBeNull()
  })

  it("offers Settings when Live Activities are off, and goes away once turned on", () => {
    const open = jest.spyOn(Linking, "openSettings").mockResolvedValue()
    open.mockClear()
    mockStatus = { enabled: false, error: "disabled" }
    render(<LiveNotice active accent="hab" />)
    expect(screen.getByText(/Live Activities are off/)).toBeTruthy()
    fireEvent.press(screen.getByText("Turn on"))
    expect(open).toHaveBeenCalledTimes(1)
    // Back from Settings with it switched on.
    mockStatus = { enabled: true }
    act(() => onChange?.("active"))
    expect(notice()).toBeNull()
  })

  it("reports a start that failed a moment after the screen opened", () => {
    mockStatus = { enabled: true }
    render(<LiveNotice active accent="fit" />)
    expect(notice()).toBeNull()
    mockStatus = { enabled: true, error: "ActivityAuthorizationError" }
    act(() => jest.advanceTimersByTime(1500))
    expect(screen.getByText(/Couldn't show this/)).toBeTruthy()
    // Nothing to fix in Settings for that one.
    expect(screen.queryByText("Turn on")).toBeNull()
  })

  it("says nothing when no activity runs", () => {
    mockStatus = { enabled: false, error: "disabled" }
    render(<LiveNotice active={false} accent="hab" />)
    expect(notice()).toBeNull()
  })
})
