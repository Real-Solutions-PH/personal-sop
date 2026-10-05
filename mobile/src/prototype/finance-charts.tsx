import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import Animated, {
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import Svg, { Circle } from "react-native-svg"
import { GrowBar, MOTION } from "./motion"
import { Copy, Line } from "./native-kit"
import { useTheme } from "./theme"
export const FIN_PALETTE = [
  "fin",
  "tsk",
  "hab",
  "fit",
  "life",
  "warn",
  "muted",
] as const
export function Donut({
  values,
  size = 132,
  children,
}: {
  values: number[]
  size?: number
  children?: ReactNode
}) {
  const t = useTheme(),
    r = (size - 16) / 2,
    circ = 2 * Math.PI * r,
    total = values.reduce((a, v) => a + Math.max(0, v), 0) || 1
  let acc = 0
  return (
    <View style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        rotation={-90}
        accessibilityLabel="Breakdown chart"
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={16}
          stroke={t.soft}
        />
        {values.map((v, i) => {
          const len = (Math.max(0, v) / total) * circ,
            offset = -acc
          acc += len
          return (
            <Slice
              key={`slice-${i}`}
              size={size}
              r={r}
              circ={circ}
              len={Math.max(0, len - 2)}
              offset={offset}
              color={t[FIN_PALETTE[i % FIN_PALETTE.length]]}
            />
          )
        })}
      </Svg>
      <View
        style={{
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  )
}
export function PairBars({
  pairs,
  labels,
  height = 96,
}: {
  pairs: number[][]
  labels: string[]
  height?: number
}) {
  const t = useTheme(),
    max = Math.max(1, ...pairs.flat())
  return (
    <View>
      <Line style={{ height, alignItems: "flex-end", gap: 12 }}>
        {pairs.map(([a, b], i) => (
          <Line
            key={labels[i]}
            style={{ height: "100%", flex: 1, gap: 4, alignItems: "flex-end" }}
          >
            {[a, b].map((v, j) => (
              <GrowBar
                key={`bar-${j}`}
                index={i * 2 + j}
                height={Math.max(height * 0.02, (v / max) * height)}
                style={{
                  flex: 1,
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  backgroundColor: j ? `${t.bad}b3` : `${t.good}cc`,
                }}
              />
            ))}
          </Line>
        ))}
      </Line>
      <Line style={{ marginTop: 4, gap: 12 }}>
        {labels.map((l) => (
          <Copy
            key={l}
            size={10}
            muted
            style={{ flex: 1, textAlign: "center" }}
          >
            {l}
          </Copy>
        ))}
      </Line>
    </View>
  )
}
export function FinanceBars({
  data,
  labels,
  height = 64,
}: {
  data: number[]
  labels: string[]
  height?: number
}) {
  const t = useTheme(),
    max = Math.max(1, ...data)
  return (
    <Line style={{ gap: 4, alignItems: "flex-end" }}>
      {data.map((v, i) => (
        <View key={labels[i]} style={{ flex: 1, gap: 4 }}>
          <View style={{ height, justifyContent: "flex-end" }}>
            <GrowBar
              index={i}
              height={Math.max(2, (v / max) * height)}
              style={{
                borderTopLeftRadius: 6,
                borderTopRightRadius: 6,
                backgroundColor: t.fin,
              }}
            />
          </View>
          <Copy size={10} muted style={{ textAlign: "center" }}>
            {labels[i]}
          </Copy>
        </View>
      ))}
    </Line>
  )
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle)
/** One donut slice; slices fan out from the top when the chart appears. */
function Slice({
  size,
  r,
  circ,
  len,
  offset,
  color,
}: {
  size: number
  r: number
  circ: number
  len: number
  offset: number
  color: string
}) {
  const reduced = useReducedMotion()
  const p = useSharedValue(reduced ? 1 : 0)
  useEffect(() => {
    p.value = reduced
      ? 1
      : withTiming(1, {
          duration: MOTION.reveal,
          easing: Easing.out(Easing.cubic),
        })
  }, [reduced, p])
  const props = useAnimatedProps(() => ({
    strokeDasharray: [len * p.value, circ],
    strokeDashoffset: offset * p.value,
  }))
  return (
    <AnimatedCircle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      strokeWidth={16}
      stroke={color}
      animatedProps={props}
    />
  )
}
