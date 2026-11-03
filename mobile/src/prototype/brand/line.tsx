// The hand-drawn line as React Native parts (ADR-0032). Each part keeps the
// shape and size of the primitive it draws for; only the ink changes: a dotted
// track, a stroke with a thinner echo just off it, round caps.
import { View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { useTheme } from "../theme"
import { strokeAcross, strokeUp } from "./scribble"

const W = 200

/** The progress track behind `Bar`: dotted where there is nothing yet, a
 * scribbled stroke for the value, sized by its parent. */
export function LineTrack({
  value,
  color,
  height,
  track,
}: {
  value: number
  color: string
  height: number
  /** The dotted track's colour; the theme's muted ink when not given. A
   * share card passes its own ink, which follows the card's ground. */
  track?: string
}) {
  const t = useTheme()
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  const H = 12,
    y = H / 2,
    x1 = 3 + v * (W - 6)
  const d = v > 0 ? strokeAcross(3, x1, y, Math.round(v * 97) + 3) : ""
  return (
    <Svg
      width="100%"
      height={Math.max(height, 8)}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (height - Math.max(height, 8)) / 2,
      }}
    >
      <Path
        d={`M3 ${y} H${W - 3}`}
        stroke={track ?? t.muted}
        strokeWidth={1.4}
        strokeDasharray="1 4"
        strokeLinecap="round"
        opacity={0.5}
        vectorEffect="non-scaling-stroke"
      />
      {d ? (
        <>
          <Path
            d={d}
            stroke={color}
            strokeWidth={height}
            strokeLinecap="round"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          <Path
            d={d}
            stroke={color}
            strokeWidth={Math.max(1.5, height * 0.4)}
            strokeLinecap="round"
            fill="none"
            opacity={0.5}
            transform="translate(0.6 -1)"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : null}
    </Svg>
  )
}

/** One bar of a small bar chart, drawn as a hand-drawn stem filling its box.
 * The box is the animated `GrowBar`, so the stem grows with it. */
export function LineStem({
  color,
  width,
  seed,
  opacity = 1,
}: {
  color: string
  width: number
  seed: number
  opacity?: number
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", opacity }}>
      <Svg
        width={width + 4}
        height="100%"
        viewBox="0 0 10 100"
        preserveAspectRatio="none"
      >
        <Path
          d={strokeUp(5, 98, 2, seed)}
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
        <Path
          d={strokeUp(5.6, 96, 4, seed + 11)}
          stroke={color}
          strokeWidth={Math.max(1, width * 0.4)}
          strokeLinecap="round"
          fill="none"
          opacity={0.5}
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
    </View>
  )
}
