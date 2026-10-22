// A caller passing `color: undefined` (a conditional colour that didn't
// apply) keeps the theme's text colour; the platform default is black,
// which vanished on the dark Today plan.
import { render, screen } from "@testing-library/react-native"
import { StyleSheet } from "react-native"

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

const { Copy } = require("../native-kit") as typeof import("../native-kit")
const { useTheme } = require("../theme") as typeof import("../theme")

let theme: ReturnType<typeof useTheme>
function Probe() {
  theme = useTheme()
  return (
    <>
      <Copy muted style={{ color: undefined }}>
        muted time
      </Copy>
      <Copy style={{ color: undefined }}>plain</Copy>
      <Copy style={{ color: "#ff0000" }}>red</Copy>
    </>
  )
}

it("keeps the theme colour when style.color is undefined", () => {
  render(<Probe />)
  const colorOf = (text: string) =>
    StyleSheet.flatten(screen.getByText(text).props.style).color
  expect(colorOf("muted time")).toBe(theme.muted)
  expect(colorOf("plain")).toBe(theme.text)
  expect(colorOf("red")).toBe("#ff0000")
})
