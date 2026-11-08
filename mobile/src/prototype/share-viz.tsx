// Two more chart pieces for share cards, drawn in the card library's hand
// (ADR-0032): a part-to-whole line and a day timeline. They live beside the
// kit (share-kit.tsx) rather than in it, and use only its public pieces, so
// each card file can import them without touching the composer.

import { View } from "react-native"
import Svg, { G, Path, Text as SvgText } from "react-native-svg"
import { jitter, rng, smooth } from "./brand/scribble"
import { ribLeaf } from "./share-deco"
import { fmt } from "./share-format"
import { Label, Num, P, useCard } from "./share-kit"
import { fonts } from "./theme"

const f1 = (n: number) => Math.round(n * 10) / 10

/** A word drawn inside a chart: it grows toward the photo floor and takes a
 * soft outline of the shadow colour on a photo (SVG text has no shadow). */
function VizWord({
  x,
  y,
  children,
  color,
  anchor = "middle",
}: {
  x: number
  y: number
  children: string
  color: string
  anchor?: "start" | "middle" | "end"
}) {
  const { c, floor } = useCard(),
    size = floor === undefined ? 12 : Math.min(14, floor / P)
  return (
    <>
      {c.shadow ? (
        <SvgText
          x={x}
          y={y}
          fill="none"
          stroke={c.shadow}
          strokeWidth={size * 0.28}
          strokeLinejoin="round"
          fontFamily={fonts.medium}
          fontSize={size}
          textAnchor={anchor}
        >
          {children}
        </SvgText>
      ) : null}
      <SvgText
        x={x}
        y={y}
        fill={color}
        fontFamily={fonts.medium}
        fontSize={size}
        textAnchor={anchor}
      >
        {children}
      </SvgText>
    </>
  )
}

/** One hand-drawn stroke along the line from ``x0`` to ``x1``. */
function stroke(x0: number, x1: number, y: number, seed: number) {
  const w = x1 - x0
  return smooth(
    jitter(
      [
        [x0, y],
        [x0 + w * 0.33, y - 0.6],
        [x0 + w * 0.66, y + 0.6],
        [x1, y],
      ],
      Math.min(1.1, w / 30),
      rng(seed),
    ),
  )
}

export type Part = {
  key: string
  /** What the part is, said under its figure: "done", "moved". */
  label: string
  value: number
  color: string
  /** A part that is not a win (moved, still open): drawn dotted. */
  open?: boolean
  /** The figure under the line; ``fmt(value)`` by default. */
  shown?: string
}
/** A part-to-whole line: one stroke split into its parts, the first one
 * ending in a leaf when it is the whole, each part's figure under the line
 * in that part's colour, so no legend is needed. A part of 0 keeps its
 * figure (an honest 0) but takes no length. */
export function PartLine({ parts, label }: { parts: Part[]; label: string }) {
  const { q, c } = useCard(),
    p = P * q,
    total = parts.reduce((n, x) => n + Math.max(0, x.value), 0),
    gap = 6,
    drawn = parts.filter((x) => x.value > 0),
    room = 300 - gap * Math.max(0, drawn.length - 1)
  let x = 6
  const segs = drawn.map((part, i) => {
    const w = total ? (part.value / total) * room : 0,
      seg = { part, x0: x, x1: x + Math.max(2, w), i }
    x += w + gap
    return seg
  })
  const whole = drawn.length === 1 && segs[0]
  return (
    <View style={{ gap: 8 * p }}>
      <View accessible accessibilityRole="image" accessibilityLabel={label}>
        <Svg width={312 * p} height={22 * p} viewBox="0 0 312 22">
          {total === 0 ? (
            <Path
              d="M6 12 H306"
              stroke={c.track}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray="1 5"
            />
          ) : null}
          {segs.map(({ part, x0, x1, i }) => (
            <Path
              key={part.key}
              d={stroke(x0, x1, 12, i * 11 + 5)}
              fill="none"
              stroke={part.color}
              strokeWidth={part.open ? 3 : 7}
              strokeLinecap="round"
              strokeDasharray={part.open ? "1 6" : undefined}
            />
          ))}
          {whole && !whole.part.open ? (
            <Path
              d={ribLeaf(whole.x1, 10, 11, -1.1, 0.42, false)}
              fill={c.mark}
              stroke={c.mark}
              strokeWidth={0.8}
            />
          ) : null}
        </Svg>
      </View>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          columnGap: 22 * p,
          rowGap: 4 * p,
        }}
      >
        {parts.map((part) => (
          <View key={part.key} style={{ minWidth: 0, maxWidth: "100%" }}>
            <Num size={18 * P} color={part.value > 0 ? part.color : c.muted}>
              {part.shown ?? fmt(part.value)}
            </Num>
            <Label>{part.label}</Label>
          </View>
        ))}
      </View>
    </View>
  )
}

export type Span = {
  start: number
  end: number
  kind: "focus" | "break" | "pause"
}
const hourOf = (ms: number) => {
  const d = new Date(ms)
  return d.getHours()
}
const hourLabel = (h: number) => {
  const x = ((h % 24) + 24) % 24
  return x === 0 ? "12a" : x < 12 ? `${x}a` : x === 12 ? "12p" : `${x - 12}p`
}
/** A day's sessions on one hand-drawn line from the first hour to the last:
 * focus as a thick stroke in the area colour with a leaf on each finished
 * stretch, breaks as a thin stroke in the mark colour, pauses dotted. Hours
 * are written under it. */
export function DayLine({
  spans,
  color,
  height,
  label,
  leaves = true,
}: {
  spans: Span[]
  color: string
  height: number
  label: string
  /** A leaf at the end of each focus stretch (a finished Pomodoro). */
  leaves?: boolean
}) {
  const { q, c } = useCard(),
    p = P * q
  if (!spans.length) return null
  const lo = Math.min(...spans.map((s) => s.start)),
    hi = Math.max(...spans.map((s) => s.end)),
    h0 = hourOf(lo),
    first = new Date(lo)
  first.setMinutes(0, 0, 0)
  const from = first.getTime(),
    hours = Math.max(1, Math.ceil((hi - from) / 3600_000)),
    to = from + hours * 3600_000,
    X = (ms: number) => 6 + ((ms - from) / (to - from)) * 300,
    mid = height - 22,
    step = hours <= 4 ? 1 : hours <= 8 ? 2 : hours <= 14 ? 3 : 4
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={312 * p} height={height * p} viewBox={`0 0 312 ${height}`}>
        <Path
          d={`M6 ${mid} H306`}
          stroke={c.track}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray="1 5"
        />
        {spans.map((s, i) => {
          const x0 = X(s.start),
            x1 = Math.max(x0 + 1.5, X(s.end))
          return (
            <G key={`${s.start}-${i}`}>
              <Path
                d={stroke(x0, x1, mid, i * 7 + 3)}
                fill="none"
                stroke={s.kind === "focus" ? color : c.mark}
                strokeWidth={
                  s.kind === "focus" ? 9 : s.kind === "break" ? 3 : 2
                }
                strokeLinecap="round"
                strokeDasharray={s.kind === "pause" ? "1 4" : undefined}
                opacity={s.kind === "focus" ? 1 : 0.85}
              />
              {leaves &&
              s.kind === "focus" &&
              spans[i + 1]?.kind !== "pause" &&
              x1 - x0 > 8 ? (
                <Path
                  d={ribLeaf(
                    x1,
                    mid - 5,
                    10,
                    i % 2 ? -1.0 : -2.15,
                    0.42,
                    false,
                  )}
                  fill={c.mark}
                  stroke={c.mark}
                  strokeWidth={0.8}
                />
              ) : null}
            </G>
          )
        })}
        {Array.from({ length: Math.floor(hours / step) + 1 }, (_, k) => {
          const h = k * step
          return (
            <VizWord
              key={h}
              x={f1(Math.min(300, Math.max(12, X(from + h * 3600_000))))}
              y={height - 3}
              color={c.muted}
            >
              {hourLabel(h0 + h)}
            </VizWord>
          )
        })}
      </Svg>
    </View>
  )
}
