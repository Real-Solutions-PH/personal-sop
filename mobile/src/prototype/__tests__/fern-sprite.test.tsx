// Fern as the C1 wreath sprite: each of the seven states draws its own face
// and mood marks, consoling wilts to the dry colours, `still` holds a pose,
// and Reduced Motion keeps the face alive (and a win's wave and twinkles)
// while the body stays put.
import { configureStorage, resetAll } from "@domain/lib/store"
import { act, render, screen } from "@testing-library/react-native"
import { cloneElement } from "react"
import { Circle, Ellipse, Path, Stop } from "react-native-svg"
import type { ReactTestInstance } from "react-test-renderer"
import { fernMoods, fernPalette } from "../companion/brand"
import { FERN_STATES, fernShapes } from "../companion/fern-geometry"
import { renameCompanion } from "../companion/store"

// `at` pins the sprite's clock (ms); `repeats` records how it was started.
const mockMotion = {
  reduced: true,
  at: undefined as number | undefined,
  repeats: [] as unknown[][],
}
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown, config: unknown) => {
    mockMotion.repeats.push(["timing", config])
    return mockMotion.at ?? value
  },
  withRepeat: (anim: unknown, ...rest: unknown[]) => {
    mockMotion.repeats.push(["repeat", ...rest])
    return anim
  },
  useReducedMotion: () => mockMotion.reduced,
}))

const { FernSprite } =
  require("../companion/fern-sprite") as typeof import("../companion/fern-sprite")

beforeEach(() => {
  configureStorage({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })
  resetAll()
  mockMotion.reduced = true
  mockMotion.at = undefined
  mockMotion.repeats = []
})

const p = fernPalette(false),
  m = fernMoods(false)
// The svg elements as drawn, with the props the sprite gave them.
const SHAPES: unknown[] = [Path, Circle, Ellipse, Stop]
const all = (match: (props: Record<string, unknown>) => boolean) =>
  screen.UNSAFE_root.findAll(
    (n: ReactTestInstance) => SHAPES.includes(n.type) && match(n.props),
    { deep: true },
  )
const filled = (color: string) => all((x) => x.fill === color)
const stroked = (color: string) => all((x) => x.stroke === color)
const drawn = (d: string) => all((x) => x.d === d)

describe.each(FERN_STATES)("%s", (state) => {
  test("is Fern, named as the companion is named, in its state", () => {
    render(<FernSprite size={88} state={state} dark={false} />)
    const fern = screen.getByTestId(`fern-${state}`)
    expect(fern.props.accessibilityLabel).toBe("Fern")
    expect(fern.props.accessibilityState).toEqual({
      busy: state === "thinking",
    })
    // The C1 parts every state keeps: the wreath, the orb, the curl, the arms.
    const s = fernShapes(state, false)
    expect(drawn(s.wreath.left).length).toBeGreaterThan(0)
    expect(drawn(s.wreath.right).length).toBeGreaterThan(0)
    expect(drawn(s.arms.left).length).toBeGreaterThan(0)
    // The orb is the only disc: no glow or halo circle behind Fern.
    const discs = all((x) => typeof x.r === "number" && x.cx === 32)
    expect(discs.map((n) => n.props.r)).toEqual(
      state === "consoling" ? [14, 14] : [14],
    )
  })
})

test("arriving: the face opens with two sprout twinkles", () => {
  render(<FernSprite size={88} state="arriving" dark={false} />)
  expect(filled(p.sprout).length).toBeGreaterThanOrEqual(4) // 2 arms + 2 twinkles
  expect(all((x) => x.fill === "#fff" && x.rx !== undefined)).toHaveLength(2)
})

test("idle: a resting smile and no mood marks", () => {
  render(<FernSprite size={88} state="idle" dark={false} />)
  expect(fernShapes("idle", false).mood).toHaveLength(0)
  expect(drawn(fernShapes("idle", false).mouth)).toHaveLength(1)
  expect(filled(m.joy)).toHaveLength(0)
})

test("listening: ripples spread on the ground and the arms cup in", () => {
  render(<FernSprite size={88} state="listening" dark={false} />)
  expect(stroked(m.water)).toHaveLength(3)
})

test("thinking: spores drift beside the wreath", () => {
  render(<FernSprite size={88} state="thinking" dark={false} />)
  expect(filled(m.think)).toHaveLength(6)
})

test("speaking: the mouth opens and lines pulse either side", () => {
  render(<FernSprite size={88} state="speaking" dark={false} />)
  const talk = fernShapes("speaking", false).talk
  expect(all((x) => x.cy === talk.cy && x.rx === talk.rx)).toHaveLength(1)
  expect(stroked(p.frond)).toHaveLength(6)
})

test("celebrating: happy eyes, the curl opened, joy and love twinkles", () => {
  const live = render(<FernSprite size={88} state="celebrating" dark={false} />)
  const s = fernShapes("celebrating", false)
  expect(drawn(s.happyEyes)).toHaveLength(1)
  // The curl unfurls: the closed one fades out as the open one fades in.
  expect(drawn(s.curlOpen)).toHaveLength(1)
  expect(drawn(s.curl)).toHaveLength(1)
  expect(filled(m.joy)).toHaveLength(3)
  expect(filled(m.love)).toHaveLength(2)
  live.unmount()
  // A still pose holds it open.
  render(<FernSprite size={88} state="celebrating" still dark={false} />)
  expect(drawn(s.curlOpen)).toHaveLength(1)
  expect(drawn(s.curl)).toHaveLength(0)
})

test("consoling: wilts to dry olive and straw, with dewy eyes and falling leaves", () => {
  render(<FernSprite size={88} state="consoling" dark={false} />)
  const stops = all((x) => typeof x.stopColor === "string").map(
    (n) => n.props.stopColor,
  )
  expect(stops).toEqual(expect.arrayContaining([m.sad1, m.sad2, m.sad3]))
  expect(filled(m.sad3).length).toBe(2) // both arms, wilted
  expect(filled(m.wilt)).toHaveLength(2) // two leaves fall
  expect(filled(m.dew).length).toBe(4) // two welling eyes, two tears
})

test("small sizes tighten the box and drop cheeks and mood marks", () => {
  render(<FernSprite size={24} state="celebrating" dark={false} />)
  expect(fernShapes("celebrating", true).viewBox).toEqual([6, 10, 52, 52])
  expect(filled(m.blush)).toHaveLength(0)
  expect(filled(m.joy)).toHaveLength(0)
})

test("the dark set draws the dark colours", () => {
  render(<FernSprite size={88} state="consoling" dark />)
  const dark = fernMoods(true)
  expect(filled(dark.wilt)).toHaveLength(2)
  expect(stroked(dark.wiltInk).length).toBeGreaterThan(0)
  expect(stroked(m.wiltInk)).toHaveLength(0)
})

test("Reduced Motion and still hold the pose: no leaves lift on a win", () => {
  const lifted = () => all((x) => x.fill === p.sprout && x.strokeWidth === 0.8)
  mockMotion.reduced = false
  const live = render(<FernSprite size={88} state="celebrating" dark={false} />)
  expect(lifted()).toHaveLength(5)
  live.unmount()
  render(<FernSprite size={88} state="celebrating" still dark={false} />)
  expect(lifted()).toHaveLength(0)
  mockMotion.reduced = true
})

test("follows the companion's name", () => {
  renameCompanion("Moss")
  render(<FernSprite size={40} state="idle" />)
  expect(screen.getByLabelText("Moss")).toBeTruthy()
})

test("decorative leaves the row's label to speak for it", () => {
  render(<FernSprite size={40} state="consoling" decorative />)
  expect(
    screen.getByTestId("fern-consoling", { includeHiddenElements: true }).props
      .accessibilityLabel,
  ).toBe(undefined)
  expect(screen.queryByTestId("fern-consoling")).toBeNull()
})

// Every moving part's transform, as the sprite styled it at the pinned clock.
const transforms = () =>
  screen.UNSAFE_root.findAll(
    (n: ReactTestInstance) =>
      Array.isArray(n.props.style) && !!n.props.style[0]?.transformOrigin,
  ).flatMap(
    (n) =>
      (n.props.style[1]?.transform ?? []) as Record<string, number | string>[],
  )
/** Render, then once more: the clock starts in an effect after the first. */
const renderAt = (ui: React.ReactElement) =>
  render(ui).rerender(cloneElement(ui))
const scaled = (key: "scale" | "scaleY") =>
  transforms()
    .map((x) => x[key])
    .filter((v): v is number => typeof v === "number" && Math.abs(v - 1) > 1e-3)

// 2.1 s in: mid-blink (eyes at 0.1) and past the top of a breath.
test("idle breathes and blinks", () => {
  mockMotion.reduced = false
  mockMotion.at = 2100
  renderAt(<FernSprite size={88} state="idle" dark={false} />)
  expect(scaled("scale").some((v) => v > 1.02)).toBe(true)
  expect(scaled("scaleY")).toContainEqual(expect.closeTo(0.1, 3))
})

test("Reduced Motion: the clock still runs, Fern blinks but does not breathe", () => {
  mockMotion.at = 2100
  renderAt(<FernSprite size={88} state="idle" dark={false} />)
  // Reanimated would jump the clock to its end under Reduce Motion.
  expect(mockMotion.repeats).toContainEqual([
    "timing",
    expect.objectContaining({ reduceMotion: "never" }),
  ])
  expect(mockMotion.repeats).toContainEqual([
    "repeat",
    -1,
    false,
    undefined,
    "never",
  ])
  expect(scaled("scale")).toEqual([])
  expect(scaled("scaleY")).toContainEqual(expect.closeTo(0.1, 3))
})

// A win under Reduce Motion: the arms still wave in place (their turn
// changes over the clock) while the body never hops. The same probe sees
// the hop with Reduce Motion off, so it can tell the two apart.
const celebrateAt = (ms: number) => {
  mockMotion.at = ms
  const ui = <FernSprite size={88} state="celebrating" dark={false} />
  const r = render(ui)
  r.rerender(cloneElement(ui))
  const turns = transforms()
    .map((x) => x.rotate)
    .filter((v): v is string => typeof v === "string")
  const lifted = transforms()
    .map((x) => x.translateY)
    .filter((v): v is number => typeof v === "number" && Math.abs(v) > 1e-3)
  r.unmount()
  return { turns, lifted }
}

test("Reduced Motion: a celebrating Fern still waves, without hopping", () => {
  const rest = celebrateAt(0),
    mid = celebrateAt(600)
  expect(mid.turns).not.toEqual(rest.turns)
  expect(celebrateAt(240).lifted).toEqual([])
  mockMotion.reduced = false
  expect(celebrateAt(240).lifted.length).toBeGreaterThan(0)
})

test("still starts no clock and moves nothing", () => {
  mockMotion.reduced = false
  mockMotion.at = 2100
  renderAt(<FernSprite size={88} state="idle" still dark={false} />)
  expect(mockMotion.repeats).toEqual([])
  expect(scaled("scale")).toEqual([])
  expect(scaled("scaleY")).toEqual([])
})

test("arriving settles into idle instead of holding its last frame", () => {
  jest.useFakeTimers()
  try {
    render(<FernSprite size={88} state="arriving" dark={false} />)
    expect(screen.getByTestId("fern-arriving")).toBeTruthy()
    act(() => jest.advanceTimersByTime(2000))
    expect(screen.getByTestId("fern-idle")).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})
