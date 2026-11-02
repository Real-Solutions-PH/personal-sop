// A dashed horizontal line across a chart (a goal, a limit, a target), drawn
// in SVG so the dashes show on every platform and a bar reaching it can be
// seen through the gaps.
import { View } from "react-native"
import Svg, { Line } from "react-native-svg"

export function DashedRule({
  bottom,
  color,
  width = 1.5,
  testID,
}: {
  /** Distance from the chart's floor, in points. */
  bottom: number
  color: string
  width?: number
  testID?: string
}) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottom - width / 2,
        height: width,
      }}
    >
      <Svg width="100%" height={width}>
        <Line
          x1="0"
          y1={width / 2}
          x2="100%"
          y2={width / 2}
          stroke={color}
          strokeWidth={width}
          strokeDasharray="5 4"
        />
      </Svg>
    </View>
  )
}
