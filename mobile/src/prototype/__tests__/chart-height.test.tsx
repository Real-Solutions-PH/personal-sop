// Reveal fills its parent's height. A chart whose parent was sized by its
// own content grew without end on iOS (the Body weight graph), so each
// chart pins Reveal inside a box of its stated height.
import { render } from "@testing-library/react-native"
import { StyleSheet } from "react-native"
import { FinanceLineChart, FitnessTrend } from "../chart"

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

type Node = { props?: { style?: unknown }; children?: unknown[] }
const styleOf = (n: Node) =>
  (StyleSheet.flatten(n.props?.style as never) ?? {}) as {
    height?: unknown
    width?: unknown
  }
/** The height of the box that holds Reveal (whose own style is 100% x 100%). */
const revealParentHeight = (json: unknown): unknown => {
  let found: unknown = "no Reveal"
  const walk = (n: unknown, parent?: Node) => {
    if (!n || typeof n !== "object") return
    const node = n as Node
    const st = styleOf(node)
    if (st.width === "100%" && st.height === "100%" && parent)
      found = styleOf(parent).height
    for (const c of node.children ?? []) walk(c, node)
  }
  walk(json)
  return found
}

test("the body weight trend sits in a box of its own height", () => {
  const view = render(
    <FitnessTrend height={110} line={[70, 69.8, 69.5]} dots={[70.2, 69.6]} />,
  )
  expect(revealParentHeight(view.toJSON())).toBe(110)
})

test("the finance line chart sits in a box of its own height", () => {
  const view = render(
    <FinanceLineChart
      height={150}
      series={[{ values: [1, 3, 2], color: "#000" }]}
      labels={["a", "b", "c"]}
    />,
  )
  expect(revealParentHeight(view.toJSON())).toBe(150)
})
