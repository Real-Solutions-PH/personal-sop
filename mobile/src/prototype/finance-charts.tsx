import type { ReactNode } from "react"
import { View } from "react-native"
import Svg, { Circle } from "react-native-svg"
import { Copy, Line } from "./native-kit"
import { useTheme } from "./theme"
// Eight visibly distinct hues — `life` and `warn` were near-identical ambers,
// and a 7-slot cycle repeated the first colour on the 8th slice.
export const FIN_PALETTE = [
  "fin",
  "tsk",
  "hab",
  "fit",
  "life",
  "nut",
  "acct-cyan",
  "acct-slate",
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
            <Circle
              key={`slice-${i}`}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={16}
              strokeDasharray={`${Math.max(0, len - 2)} ${circ}`}
              strokeDashoffset={offset}
              stroke={t[FIN_PALETTE[i % FIN_PALETTE.length]]}
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
              <View
                key={`bar-${j}`}
                style={{
                  flex: 1,
                  height: Math.max(height * 0.02, (v / max) * height),
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
            <View
              style={{
                height: Math.max(2, (v / max) * height),
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
