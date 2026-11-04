import { compact } from "@domain/finance/calc"
import { num } from "@domain/lib/num"
import { privacyStore } from "@domain/lib/privacy"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import { runOnJS } from "react-native-reanimated"
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polygon,
  Polyline,
  Text as SvgText,
} from "react-native-svg"
import { LineStem } from "./brand/line"
import { type Point, smooth } from "./brand/scribble"
import { pointAt, pointX, readoutLeft } from "./chart-inspect"
import { feel, GrowBar, Reveal } from "./motion"
import { BAR_HEIGHT } from "./native-kit"
import { fonts, radius, useTheme } from "./theme"

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
      <Reveal>
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
      </Reveal>
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
      <View
        style={{
          height: BAR_HEIGHT,
          backgroundColor: t.soft,
          borderRadius: BAR_HEIGHT / 2,
        }}
      >
        <View
          style={{
            width: `${Math.min(100, Math.max(0, (value / Math.max(1, max)) * 100))}%`,
            height: BAR_HEIGHT,
            borderRadius: BAR_HEIGHT / 2,
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
  label,
  selected,
  onSelect,
  barLabels,
}: {
  values: number[]
  labels: string[]
  color?: string
  /** Screen-reader text; defaults to the values as percentages. */
  label?: string
  /** The highlighted bar; defaults to the last (today). */
  selected?: number
  /** Makes each bar a button, read out as its `barLabels` entry. */
  onSelect?: (index: number) => void
  barLabels?: string[]
}) {
  const t = useTheme()
  const max = Math.max(1, ...values)
  const lit = selected ?? values.length - 1
  return (
    <View
      // Tappable bars are read one by one; a single image would hide them.
      {...(onSelect
        ? {}
        : {
            accessibilityRole: "image" as const,
            accessibilityLabel:
              label ??
              `Daily form: ${values.map((v) => `${Math.round(v * 100)}%`).join(", ")}`,
          })}
      style={{
        flexDirection: "row",
        gap: values.length > 14 ? 2 : 4,
        height: 116,
        alignItems: "flex-end",
        paddingTop: 12,
      }}
    >
      {values.map((v, i) => (
        <Pressable
          key={`${i}-${labels[i]}`}
          disabled={!onSelect}
          onPress={() => onSelect?.(i)}
          accessible={!!onSelect}
          accessibilityRole={onSelect ? "button" : undefined}
          accessibilityLabel={onSelect ? barLabels?.[i] : undefined}
          accessibilityState={onSelect ? { selected: i === lit } : undefined}
          style={{ flex: 1, alignItems: "center", gap: 6 }}
        >
          <GrowBar
            index={i}
            height={Math.max(3, (v / max) * 82)}
            style={{ width: "100%" }}
          >
            <LineStem
              color={color ?? t.life}
              width={values.length > 14 ? 3 : 7}
              seed={i + 3}
              opacity={i === lit ? 1 : 0.45}
            />
          </GrowBar>
          <Text
            // A month of bars leaves ~6pt a column: "15" must not wrap.
            numberOfLines={1}
            style={{
              width: 28,
              textAlign: "center",
              fontFamily: fonts.body,
              fontSize: 10,
              color: i === lit && onSelect ? t.text : t.muted,
            }}
          >
            {labels[i]}
          </Text>
        </Pressable>
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
  const curve = smooth(
    values.map(
      (v, i): Point => [
        (i / (values.length - 1)) * 100,
        height - ((v - min) / span) * (height - 4) - 2,
      ],
    ),
  )
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ height, width: "100%" }}
    >
      <Reveal>
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
              opacity={0.12}
            />
          )}
          {/* The brand's hand-drawn line (ADR-0032): a smooth stroke and a
              thinner echo just off it. */}
          <Path
            d={curve}
            stroke={color}
            strokeWidth={2.4}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
          <Path
            d={curve}
            stroke={color}
            strokeWidth={1}
            strokeLinecap="round"
            opacity={0.5}
            transform="translate(0.4 -0.8)"
            vectorEffect="non-scaling-stroke"
            fill="none"
          />
        </Svg>
      </Reveal>
    </View>
  )
}

/** Touch to read a point: the point shown (null for none), its setter,
 * and what the readout over the marker says about it. */
export type ChartInspect = {
  at: number | null
  onAt: (i: number | null) => void
  readout: (i: number) => ReactNode
}

export function FinanceLineChart({
  series,
  labels,
  floor,
  height = 170,
  zero = false,
  inspect,
}: {
  /** A series shorter than the longest one stops early on the same x
   * scale, so an actual line can end at today under a full-month plan. */
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
  /** Opt in to touch: a finger on the chart picks the nearest point and
   * shows a marker and a readout. Without it the chart is unchanged. */
  inspect?: ChartInspect
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
  min -= span * 0.08
  max += span * 0.08
  const n = Math.max(2, labels.length, ...series.map((s) => s.values.length)),
    x = (i: number) => 40 + (i / (n - 1)) * 292,
    y = (v: number) => 10 + (1 - (v - min) / (max - min)) * (height - 30),
    ticks = [
      max - (max - min) * 0.08,
      (max + min) / 2,
      min + (max - min) * 0.08,
    ],
    every = Math.ceil(labels.length / 6),
    // A few labels among blanks are placed by the caller: print them all.
    sparse = labels.some((l) => !l) && labels.filter(Boolean).length <= 6,
    // Labels that would overlap give way to the one after them, so the last
    // label (usually the end date) always shows.
    shown = new Set<number>()
  for (
    let i = labels.length - 1, next = Number.POSITIVE_INFINITY;
    i >= 0;
    i--
  ) {
    if (
      !labels[i] ||
      !(sparse || i % every === 0 || i === labels.length - 1) ||
      next - x(i) < 44
    )
      continue
    shown.add(i)
    next = x(i)
  }
  const at = inspect?.at ?? null
  const chart = (
    // A fixed box: Reveal fills its parent's height, and a parent sized by
    // its content made the chart grow without end on iOS.
    <View style={{ height }}>
      <Reveal>
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
                fontSize={9}
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
                fontSize={8}
              >
                minimum
              </SvgText>
            </G>
          )}
          {series.map((s, i) => {
            if (s.values.length < 2) return null
            const d = s.values
              .map(
                (v, i) =>
                  `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`,
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
            shown.has(i) ? (
              <SvgText
                key={i}
                x={x(i)}
                y={height - 5}
                textAnchor={i === labels.length - 1 && i > 0 ? "end" : "middle"}
                fill={t.muted}
                fontSize={9}
                fontFamily={fonts.body}
              >
                {l}
              </SvgText>
            ) : null,
          )}
          {at !== null && (
            <G>
              <Line
                x1={x(at)}
                x2={x(at)}
                y1={10}
                y2={height - 20}
                stroke={t.text}
                strokeWidth={1}
                opacity={0.4}
              />
              {series.map((s, k) =>
                s.values[at] === undefined ? null : (
                  <Circle
                    key={k}
                    cx={x(at)}
                    cy={y(s.values[at])}
                    r={4}
                    fill={s.color}
                    stroke={t.card}
                    strokeWidth={1.5}
                  />
                ),
              )}
            </G>
          )}
        </Svg>
      </Reveal>
    </View>
  )
  if (!inspect) return chart
  return (
    <Inspectable n={n} height={height} inspect={inspect}>
      {chart}
    </Inspectable>
  )
}

/** The touch layer over an inspectable chart. A tap or a drag picks the
 * nearest point; the marker snaps from point to point (no in-between
 * values are made up), with a light tick each time it moves on. Letting go
 * keeps the point; the screen clears it on a touch anywhere else, so this
 * box keeps its own touches from reaching the screen. */
function Inspectable({
  n,
  height,
  inspect,
  children,
}: {
  n: number
  height: number
  inspect: ChartInspect
  children: ReactNode
}) {
  const t = useTheme()
  const [width, setWidth] = useState(0)
  const [readoutW, setReadoutW] = useState(0)
  const shown = useRef(inspect.at)
  useEffect(() => {
    shown.current = inspect.at
  }, [inspect.at])
  const pick = (px: number) => {
    const i = pointAt(px, width, height, height, n)
    if (i === shown.current) return
    shown.current = i
    feel.select()
    inspect.onAt(i)
  }
  const step = (d: 1 | -1) => {
    const from = shown.current ?? (d > 0 ? -1 : n)
    const i = Math.min(n - 1, Math.max(0, from + d))
    shown.current = i
    inspect.onAt(i)
  }
  // Sideways drags are the chart's; up and down still scroll the page.
  const pan = Gesture.Pan()
    .activeOffsetX([-4, 4])
    .failOffsetY([-12, 12])
    .onStart((e) => runOnJS(pick)(e.x))
    .onUpdate((e) => runOnJS(pick)(e.x))
  const tap = Gesture.Tap().onEnd((e) => runOnJS(pick)(e.x))
  const at = inspect.at
  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <View
        collapsable={false}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onTouchStart={(e) => e.stopPropagation()}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Chart"
        accessibilityHint="Touch or drag to read the expected money on a date"
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) =>
          step(e.nativeEvent.actionName === "increment" ? 1 : -1)
        }
      >
        {children}
        {at !== null && width > 0 && (
          <View
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            onLayout={(e) => setReadoutW(e.nativeEvent.layout.width)}
            style={{
              position: "absolute",
              top: 0,
              left: readoutLeft(
                pointX(at, width, height, height, n),
                readoutW,
                width,
              ),
              opacity: readoutW ? 1 : 0,
              paddingHorizontal: 10,
              paddingVertical: 8,
              gap: 2,
              borderRadius: radius.control,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.card,
            }}
          >
            {inspect.readout(at)}
          </View>
        )}
      </View>
    </GestureDetector>
  )
}

/** Same domains, ticks and sparse-series treatment as the prototype fitness chart. */
export function FitnessTrend({
  line,
  dots,
  goal,
  height = 160,
  labels,
  fmt = (n: number) => num(n),
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
    // Too few points for a trend: a faint example curve keeps the chart's
    // shape on screen, so an empty card still shows what will be there.
    return (
      <View
        style={{ height }}
        accessible
        accessibilityLabel="Trend appears after two entries"
      >
        <Svg viewBox={`0 0 300 ${height}`} width="100%" height={height}>
          <Path
            d={`M4,${height * 0.45} C70,${height * 0.3} 110,${height * 0.7} 170,${height * 0.55} S250,${height * 0.35} 296,${height * 0.5}`}
            stroke={t.muted}
            strokeOpacity={0.35}
            strokeWidth={3}
            strokeDasharray="6 6"
            fill="none"
          />
        </Svg>
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
      {/* A fixed box for Reveal: see the chart above. */}
      <View style={{ height }}>
        <Reveal>
          <Svg
            viewBox={`0 0 300 ${height}`}
            width="100%"
            height={height}
            accessibilityLabel="Trend chart"
          >
            {ticks.map((v) => (
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
                  fontSize={9}
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
        </Reveal>
      </View>
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
