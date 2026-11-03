// The share cards' scribble motif, kept to the top-right corner of Today's
// display-only cards at low strength (ADR-0032: chrome stays calm). Drawn
// behind the content; the card clips it.
import { useMemo } from "react"
import { View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { useTheme } from "../theme"
import { type CornerKind, cornerPath } from "./nature"

export function CornerMotif({
  kind,
  seed = 3,
  color,
  size = 150,
  opacity = 0.14,
}: {
  kind: CornerKind
  seed?: number
  color?: string
  size?: number
  opacity?: number
}) {
  const t = useTheme(),
    d = useMemo(() => cornerPath(kind, seed), [kind, seed]),
    ink = color ?? t.primary
  return (
    <View
      testID="corner-motif"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        top: -8,
        right: -8,
        width: size,
        height: size,
        opacity,
      }}
    >
      <Svg
        width="100%"
        height="100%"
        viewBox="0 0 360 360"
        preserveAspectRatio="xMidYMid slice"
      >
        <Path
          d={d}
          fill="none"
          stroke={ink}
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={d}
          fill="none"
          stroke={ink}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
          transform="translate(2 -1.6)"
        />
      </Svg>
    </View>
  )
}
