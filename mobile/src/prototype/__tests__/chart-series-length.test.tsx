// A shorter series sits on the longest series' x scale, so an actual line
// that stops at today lines up under a full-month plan line.
import { render } from "@testing-library/react-native"
import { FinanceLineChart } from "../chart"

jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  ...require("./reanimated-extras").extras,
  default: require("react-native").Animated,
  useSharedValue: (value: unknown) =>
    require("react").useRef({ value }).current,
  useAnimatedStyle: (get: () => unknown) => get(),
  withTiming: (value: unknown) => value,
  useReducedMotion: () => true,
}))

test("the shorter series ends at its own index on the 31-point scale", () => {
  const full = Array.from({ length: 31 }, (_, i) => i)
  const short = Array.from({ length: 20 }, (_, i) => i)
  const view = render(
    <FinanceLineChart
      labels={full.map(() => "")}
      series={[
        { values: full, color: "#000000", dashed: true },
        { values: short, color: "#111111" },
      ]}
    />,
  )
  const paths = view.UNSAFE_root.findAll(
    (n) => typeof n.props.d === "string" && n.props.stroke === "#111111",
  )
  const d = paths[0].props.d as string
  const lastX = Number(d.split(" ").at(-1)?.slice(1).split(",")[0])
  // x(i) = 40 + i / (n - 1) * 292 with n = 31
  expect(lastX).toBeCloseTo(40 + (19 / 30) * 292, 0)
})
