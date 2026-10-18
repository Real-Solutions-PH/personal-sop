import { compact } from "@domain/finance/calc"
import { privacyStore } from "@domain/lib/privacy"
import { Text, View } from "react-native"
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Polyline,
  Text as SvgText,
} from "react-native-svg"
import { fonts, useTheme } from "./theme"

export function Trend({
  values,
  label,
  color,
  filled = false,
  height = 100,
  includeZero = true,
}: {
  values: number[]
  label: string
  color?: string
  filled?: boolean
  height?: number
  includeZero?: boolean
}) {
  const t = useTheme()
  const valid = values.map((v) => (Number.isFinite(v) ? v : 0))
  const low = Math.min(
      ...(includeZero ? [0, ...valid] : valid.length ? valid : [0]),
    ),
    high = Math.max(1, ...valid),
    span = high - low || 1
  const points = valid
    .map(
      (v, i) =>
        `${8 + (i * 284) / Math.max(1, valid.length - 1)},${92 - ((v - low) / span) * 80}`,
    )
    .join(" ")
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="image"
      style={{ height, width: "100%" }}
    >
      <Svg
        viewBox="0 0 300 110"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        <Line x1="8" x2="292" y1="94" y2="94" stroke={t.line} />
        {filled && (
          <Polygon
            points={`8,94 ${points} 292,94`}
            fill={`${color ?? t.accent}22`}
          />
        )}
        <Polyline
          points={points}
          stroke={color ?? t.accent}
          strokeWidth="2"
          fill="none"
        />
      </Svg>
    </View>
  )
}
export function Bar({
  label,
  value,
  max,
  formatted,
  onPress,
}: {
  label: string
  value: number
  max: number
  formatted: string
  onPress?: () => void
}) {
  const t = useTheme()
  return (
    <View style={{ gap: 7, paddingVertical: 8 }}>
      <Text
        onPress={onPress}
        accessibilityRole={onPress ? "button" : undefined}
        style={{ color: t.text, fontSize: 15, fontFamily: fonts.body }}
      >
        {label} · {formatted}
      </Text>
      <View style={{ height: 8, backgroundColor: t.soft, borderRadius: 4 }}>
        <View
          style={{
            width: `${Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100))}%`,
            height: 8,
            borderRadius: 4,
            backgroundColor: t.accent,
          }}
        />
      </View>
    </View>
  )
}

export function DailyBars({
  values,
  labels,
  color,
}: {
  values: number[]
  labels: string[]
  color?: string
}) {
  const t = useTheme()
  const max = Math.max(1, ...values)
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={`Daily form: ${values.map((v) => `${Math.round(v * 100)}%`).join(", ")}`}
      style={{
        flexDirection: "row",
        gap: 4,
        height: 116,
        alignItems: "flex-end",
        paddingTop: 12,
      }}
    >
      {values.map((v, i) => (
        <View
          key={`${i}-${labels[i]}`}
          style={{ flex: 1, alignItems: "center", gap: 6 }}
        >
          <View
            style={{
              width: "100%",
              height: Math.max(3, (v / max) * 82),
              borderTopLeftRadius: 6,
              borderTopRightRadius: 6,
              backgroundColor: color ?? t.life,
              opacity: i === values.length - 1 ? 1 : 0.45,
            }}
          />
          <Text
            style={{ fontFamily: fonts.body, fontSize: 10, color: t.muted }}
          >
            {labels[i]}
          </Text>
        </View>
      ))}
    </View>
  )
}

// Same scale and padding as the prototype's Sparkline (no axes/baseline).
export function Sparkline({
  values,
  height = 48,
  color,
  area = true,
  label,
}: {
  values: number[]
  height?: number
  color: string
  area?: boolean
  label: string
}) {
  if (values.length < 2) return <View style={{ height }} />
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1
  const points = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * 100},${height - ((v - min) / span) * (height - 4) - 2}`,
    )
    .join(" ")
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ height, width: "100%" }}
    >
      <Svg
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
      >
        {area && (
          <Polygon
            points={`${points} 100,${height} 0,${height}`}
            fill={color}
            opacity={0.15}
          />
        )}
        <Polyline
          points={points}
          stroke={color}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          fill="none"
        />
      </Svg>
    </View>
  )
}

export function FinanceLineChart({
  series,
  labels,
  floor,
  height = 170,
  zero = false,
}: {
  series: {
    values: number[]
    color: string
    dashed?: boolean
    area?: boolean
  }[]
  labels: string[]
  floor?: number
  height?: number
  zero?: boolean
}) {
  const t = useTheme(),
    hidden = privacyStore.use((s) => s.hidden),
    all = series.flatMap((s) => s.values)
  if (floor !== undefined) all.push(floor)
  if (zero) all.push(0)
  if (!all.length) all.push(0)
  let min = Math.min(...all),
    max = Math.max(...all)
  if (min === max) {
    min -= 1
    max += 1
  }
  const span = max - min
  // Gridlines sit on the real data extremes so the line never dips past the
  // lowest one; the 8% padding only adds breathing room around them.
  const ticks = [max, (max + min) / 2, min]
  min -= span * 0.08
  max += span * 0.08
  const n = Math.max(2, series[0]?.values.length ?? 2),
    x = (i: number) => 40 + (i / (n - 1)) * 292,
    y = (v: number) => 10 + (1 - (v - min) / (max - min)) * (height - 30),
    every = Math.ceil(labels.length / 6)
  return (
    <Svg
      viewBox={`0 0 340 ${height}`}
      width="100%"
      height={height}
      accessibilityRole="image"
      accessibilityLabel="chart"
    >
      {ticks.map((v) => (
        <G key={v}>
          <Line
            x1={40}
            x2={332}
            y1={y(v)}
            y2={y(v)}
            stroke={t.line}
            strokeDasharray="2 4"
          />
          <SvgText
            x={34}
            y={y(v) + 3}
            textAnchor="end"
            fill={t.muted}
            fontSize={11}
            fontFamily={fonts.body}
          >
            {hidden ? "••••" : compact(v)}
          </SvgText>
        </G>
      ))}
      {floor !== undefined && (
        <G>
          <Line
            x1={40}
            x2={332}
            y1={y(floor)}
            y2={y(floor)}
            stroke={t.warn}
            strokeDasharray="4 3"
          />
          <SvgText
            x={332}
            y={y(floor) - 3}
            textAnchor="end"
            fill={t.warn}
            fontSize={10}
          >
            minimum
          </SvgText>
        </G>
      )}
      {series.map((s, i) => {
        if (s.values.length < 2) return null
        const d = s.values
          .map(
            (v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
          )
          .join(" ")
        return (
          <G key={i}>
            {s.area && (
              <Path
                d={`${d} L${x(s.values.length - 1)},${height - 20} L${x(0)},${height - 20} Z`}
                fill={s.color}
                opacity={0.1}
              />
            )}
            <Path
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? "5 4" : undefined}
            />
            {!s.dashed && (
              <Circle
                cx={x(s.values.length - 1)}
                cy={y(s.values.at(-1)!)}
                r={3}
                fill={s.color}
              />
            )}
          </G>
        )
      })}
      {labels.map((l, i) =>
        i % every === 0 || i === labels.length - 1 ? (
          <SvgText
            key={i}
            x={x(i)}
            y={height - 5}
            textAnchor="middle"
            fill={t.muted}
            fontSize={11}
            fontFamily={fonts.body}
          >
            {l}
          </SvgText>
        ) : null,
      )}
    </Svg>
  )
}

/** Same domains, ticks and sparse-series treatment as the prototype fitness chart. */
export function FitnessTrend({
  line,
  dots,
  goal,
  height = 160,
  labels,
  fmt = (n: number) => n.toFixed(1),
}: {
  line: (number | undefined)[]
  dots?: (number | undefined)[]
  goal?: number
  height?: number
  labels?: [string, string]
  fmt?: (n: number) => string
}) {
  const t = useTheme(),
    all = [
      ...line,
      ...(dots ?? []),
      ...(goal !== undefined ? [goal] : []),
    ].filter((v): v is number => v !== undefined)
  if (all.length < 2)
    return (
      <View style={{ height, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, color: t.muted }}>
          Not enough data yet
        </Text>
      </View>
    )
  const lo = Math.min(...all),
    hi = Math.max(...all),
    span = hi - lo || 1,
    min = lo - span * 0.08,
    max = hi + span * 0.08,
    n = Math.max(line.length, dots?.length ?? 0),
    x = (i: number) => 4 + (i / Math.max(1, n - 1)) * 260,
    y = (v: number) => 10 + (1 - (v - min) / (max - min)) * (height - 18),
    ticks = [
      max - (max - min) * 0.08,
      (max + min) / 2,
      min + (max - min) * 0.08,
    ]
  let d = ""
  line.forEach((v, i) => {
    if (v !== undefined)
      d += `${d && line[i - 1] !== undefined ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `
  })
  const last = line
    .map((v, i) => (v === undefined ? -1 : i))
    .filter((i) => i >= 0)
    .at(-1)
  return (
    <View>
      <Svg
        viewBox={`0 0 300 ${height}`}
        width="100%"
        height={height}
        accessibilityLabel="Trend chart"
      >
        {/* A tick right next to the goal line reads as a second goal value. */}
        {ticks
          .filter(
            (v) =>
              goal === undefined || Math.abs(v - goal) > (max - min) * 0.06,
          )
          .map((v) => (
            <G key={v}>
              <Line
                x1={4}
                x2={264}
                y1={y(v)}
                y2={y(v)}
                stroke={t.line}
                strokeDasharray="2 4"
              />
              <SvgText
                x={268}
                y={y(v) + 3}
                fontSize={10}
                fill={t.muted}
                fontFamily={fonts.body}
              >
                {fmt(v)}
              </SvgText>
            </G>
          ))}
        {goal !== undefined && (
          <G>
            <Line
              x1={4}
              x2={264}
              y1={y(goal)}
              y2={y(goal)}
              stroke={t.good}
              strokeDasharray="5 4"
              strokeWidth={1.2}
            />
            <SvgText x={6} y={y(goal) - 4} fill={t.good} fontSize={9}>
              goal {fmt(goal)}
            </SvgText>
          </G>
        )}
        {dots?.map((v, i) =>
          v === undefined ? null : (
            <Circle
              key={`${i}-${v}`}
              cx={x(i)}
              cy={y(v)}
              r={2}
              fill={`${t.muted}80`}
            />
          ),
        )}
        <Path
          d={d}
          fill="none"
          stroke={t.fit}
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {last !== undefined && (
          <Circle
            cx={x(last)}
            cy={y(line[last]!)}
            r={4}
            fill={t.fit}
            stroke={t.bg}
            strokeWidth={2}
          />
        )}
      </Svg>
      {labels && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            paddingRight: 36,
            marginTop: 4,
          }}
        >
          {labels.map((l, i) => (
            <Text
              key={`${i}-${l}`}
              style={{ fontFamily: fonts.body, fontSize: 10, color: t.muted }}
            >
              {l}
            </Text>
          ))}
        </View>
      )}
    </View>
  )
}
