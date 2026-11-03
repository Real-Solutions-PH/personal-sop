import { fireEvent, render, screen } from "@testing-library/react-native"
import { Target } from "lucide-react-native"
import {
  flowerTier,
  type Petal,
  petalTier,
  Rosette,
  rosetteLabel,
  rosetteShape,
} from "../brand/rosette"

const mockMotion = { reduced: false }
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  withDelay: (_: number, value: unknown) => value,
  withRepeat: (value: unknown) => value,
  withSequence: (...values: unknown[]) => values[values.length - 1],
  useReducedMotion: () => mockMotion.reduced,
}))

const petal = (key: string, value: number, extra: Partial<Petal> = {}) => ({
  key,
  label: key,
  value,
  color: "#3b8a5a",
  icon: Target,
  ...extra,
})
const ink = {
  ink: "#000",
  muted: "#666",
  good: "#0a0",
  bad: "#a00",
  mark: "#a6d277",
  hub: "#fff",
}

describe("the leaf flower", () => {
  it("buds a petal at 90 and fills it at 100, not a point earlier", () => {
    expect(petalTier(89)).toBe("grow")
    expect(petalTier(89.4)).toBe("grow")
    expect(petalTier(89.6)).toBe("bud")
    expect(petalTier(90)).toBe("bud")
    expect(petalTier(99)).toBe("bud")
    expect(petalTier(100)).toBe("full")
    expect(petalTier(130)).toBe("full")
  })

  it("draws a bud on a 90 petal and a sprig on a 100 petal, and nothing on the rest", () => {
    const s = rosetteShape(
      [petal("a", 72), petal("b", 92), petal("c", 100)],
      220,
    )
    expect(s.petals.map((p) => [!!p.bud, !!p.sprig])).toEqual([
      [false, false],
      [true, false],
      [false, true],
    ])
  })

  it("goes solid only when every area is 90+, and wreathes only when every area is 100", () => {
    expect(flowerTier([petal("a", 95), petal("b", 89)])).toBe("grow")
    expect(flowerTier([petal("a", 95), petal("b", 90)])).toBe("all90")
    expect(flowerTier([petal("a", 100), petal("b", 99)])).toBe("all90")
    expect(flowerTier([petal("a", 100), petal("b", 100)])).toBe("all100")
    expect(rosetteShape([petal("a", 100), petal("b", 99)], 220).wreath).toBe("")
    expect(
      rosetteShape([petal("a", 100), petal("b", 100)], 220).wreath,
    ).not.toBe("")
  })

  it("lets an area that is off neither hold the flower back nor win it alone", () => {
    expect(flowerTier([petal("a", 100), petal("b", 0, { off: true })])).toBe(
      "all100",
    )
    expect(flowerTier([petal("a", 0, { off: true })])).toBe("grow")
    expect(flowerTier([])).toBe("grow")
  })

  it("never puts NaN or Infinity into a path, whatever the values", () => {
    for (const values of [
      [Number.NaN, 50, 100],
      [Number.POSITIVE_INFINITY, -20, 0],
      [100, 100, 100, 100, 100, 100, 100],
      [0],
    ]) {
      const s = rosetteShape(
        values.map((v, i) => petal(`p${i}`, v, { prev: Number.NaN })),
        220,
      )
      const paths = [
        s.wreath,
        ...s.petals.flatMap((p) => [p.outline, p.fill, p.bud, p.sprig]),
      ].filter((d): d is string => !!d)
      expect(paths.length).toBeGreaterThan(0)
      for (const d of paths) expect(d).not.toMatch(/NaN|Infinity/)
      expect(
        rosetteLabel(s.petals.map((_, i) => petal(`p${i}`, values[i]))),
      ).not.toMatch(/NaN/)
    }
  })

  it("names every area and its value in one label, with the change", () => {
    expect(
      rosetteLabel([
        petal("Habits", 85, { prev: 80 }),
        petal("Tasks", 78, { prev: 78 }),
        petal("Money", 60, { prev: 66 }),
        petal("Screen time", 0, { off: true }),
      ]),
    ).toBe(
      "Score by area: Habits 85, up 5, Tasks 78, Money 60, down 6, Screen time off",
    )
  })

  it("makes each tip a button that picks its area", () => {
    const picked: string[] = []
    render(
      <Rosette
        petals={[petal("Habits", 85), petal("Tasks", 40)]}
        ink={ink}
        onSelect={(k) => picked.push(k)}
      />,
    )
    // Labels appear once the flower knows its width.
    fireEvent(screen.getByTestId("rosette"), "layout", {
      nativeEvent: { layout: { width: 320, height: 220 } },
    })
    fireEvent.press(screen.getByLabelText("Tasks: 40. Show details"))
    expect(picked).toEqual(["Tasks"])
  })

  it("blooms from 70% on its first frame, and holds still under Reduced Motion", () => {
    const all = [petal("Habits", 100), petal("Tasks", 100)]
    const scales = () =>
      screen.UNSAFE_root.findAll(
        (n) =>
          n.props.pointerEvents === "none" &&
          Array.isArray(n.props.style) &&
          n.props.style.some(
            (x: { transform?: unknown }) => x && "transform" in x,
          ),
      ).map(
        (n) =>
          n.props.style.find(
            (x: { transform?: unknown }) => x && "transform" in x,
          ).transform[0].scale,
      )
    mockMotion.reduced = false
    const { unmount } = render(<Rosette petals={all} ink={ink} />)
    const moving = scales()
    // The wreath, the mark and one sprig per petal, each drawn at once.
    expect(moving.length).toBe(4)
    for (const s of moving) expect(s).toBeGreaterThanOrEqual(0.7)
    unmount()
    mockMotion.reduced = true
    render(<Rosette petals={all} ink={ink} />)
    expect(scales()).toEqual([1, 1, 1, 1])
  })
})
