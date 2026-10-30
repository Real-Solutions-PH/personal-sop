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

/** A key for charts with two or more series; dashed series show a dash. */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[]
}) {
  return (
    <Line style={{ gap: 16, flexWrap: "wrap" }}>
      {items.map((x) => (
        <Line key={x.label} style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", gap: 2 }}>
            {(x.dashed ? [0, 1, 2] : [0]).map((i) => (
              <View
                key={i}
                style={{
                  width: x.dashed ? 4 : 14,
                  height: 2,
                  borderRadius: 1,
                  backgroundColor: x.color,
                }}
              />
            ))}
          </View>
          <Copy size={12} muted>
            {x.label}
          </Copy>
        </Line>
      ))}
    </Line>
  )
}

/** What has happened (solid) and what is still to come (outlined), on one
 * scale, for each row: money in and money out for the month. */
export function ExpectedBars({
  rows,
}: {
  rows: {
    label: string
    done: number
    ahead: number
    color: string
    value: string
  }[]
}) {
  const t = useTheme(),
    max = Math.max(1, ...rows.map((r) => r.done + r.ahead))
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r) => (
        <View key={r.label} style={{ gap: 4 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <Copy size={12} muted>
              {r.label}
            </Copy>
            <Copy size={12} weight="medium">
              {r.value}
            </Copy>
          </Line>
          <View
            style={{
              height: 10,
              borderRadius: 5,
              backgroundColor: t.soft,
              flexDirection: "row",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: `${(r.done / max) * 100}%`,
                backgroundColor: r.color,
              }}
            />
            {r.ahead > 0 && (
              <View
                style={{
                  width: `${(r.ahead / max) * 100}%`,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: r.color,
                  backgroundColor: `${r.color}26`,
                  borderTopRightRadius: 5,
                  borderBottomRightRadius: 5,
                }}
              />
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

/** Each budget's share used, month by month: one column per month, a
 * dashed line at 100%, the share printed under it, this month at full
 * strength and earlier months tinted. */
export function BudgetHistory({
  rows,
  monthLabel,
  left,
}: {
  rows: {
    id: string
    name: string
    hist: { key: string; pct: number; spent: number }[]
  }[]
  monthLabel: (key: string) => string
  /** What is left this month, printed beside each budget's name. */
  left: (id: string) => string
}) {
  const t = useTheme()
  const H = 40
  const CAP = 1.25
  return (
    <View style={{ gap: 16 }}>
      {rows.map((r) => (
        <View key={r.id} style={{ gap: 6 }}>
          <Line style={{ justifyContent: "space-between" }}>
            <Copy size={14} weight="medium" lines={1} style={{ flex: 1 }}>
              {r.name}
            </Copy>
            <Copy size={12} muted>
              {left(r.id)}
            </Copy>
          </Line>
          <View>
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: H - H / CAP,
                borderTopWidth: 1,
                borderStyle: "dashed",
                borderColor: t.muted,
              }}
            />
            <Line style={{ gap: 6, alignItems: "flex-end", height: H }}>
              {r.hist.map((h, i) => {
                const last = i === r.hist.length - 1
                const over = h.pct > 1
                const color = over ? t.bad : t.fin
                return (
                  <View
                    key={h.key}
                    style={{ flex: 1, height: H, justifyContent: "flex-end" }}
                  >
                    <GrowBar
                      index={i}
                      height={Math.max(2, (Math.min(h.pct, CAP) / CAP) * H)}
                      style={{
                        borderTopLeftRadius: 4,
                        borderTopRightRadius: 4,
                        backgroundColor: last ? color : `${color}66`,
                      }}
                    />
                  </View>
                )
              })}
            </Line>
          </View>
          <Line style={{ gap: 6 }}>
            {r.hist.map((h) => (
              <View key={h.key} style={{ flex: 1, alignItems: "center" }}>
                <Copy
                  size={12}
                  weight="medium"
                  style={{ color: h.pct > 1 ? t.bad : t.text }}
                >
                  {h.spent ? `${Math.round(h.pct * 100)}%` : "—"}
                </Copy>
                <Copy size={12} muted>
                  {monthLabel(h.key)}
                </Copy>
              </View>
            ))}
          </Line>
        </View>
      ))}
    </View>
  )
}
