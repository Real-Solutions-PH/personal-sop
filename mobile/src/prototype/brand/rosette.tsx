// The leaf flower (the share kit's ROSETTE): one petal per area around the
// Unfurl mark. A petal's length is the area's rate and its dashed outline is
// 100. Scores of 90 and 100 change the drawing itself, so a win shows where
// the number is: a bud at 90, a sprig at 100, solid outlines and a sprout
// mark when every area is 90+, and a wreath when every area is 100.
import type { ModuleKey } from "@domain/contract"
import { AREA } from "@domain/dash/data"
import type { Facet } from "@domain/dash/facets"
import {
  CheckSquare,
  Dumbbell,
  type LucideIcon,
  Smartphone,
  Target,
  Timer,
  Utensils,
  Wallet,
} from "lucide-react-native"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Pressable, Text, View } from "react-native"
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  Path,
  RadialGradient,
  Stop,
} from "react-native-svg"
import { FERN_PATHS } from "../companion/brand"
import { type Accent, fonts } from "../theme"
import { jitter, leaf, type Point, rng, smooth } from "./scribble"

export const AREA_ICONS: Record<ModuleKey, LucideIcon> = {
  habits: Target,
  tasks: CheckSquare,
  fitness: Dumbbell,
  nutrition: Utensils,
  focus: Timer,
  finance: Wallet,
  screen: Smartphone,
}

const finite = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n : 0

export interface Petal {
  key: string
  label: string
  /** The rate this period, 0 to 100. */
  value: number
  /** The rate the period before, for the ▲/▼ beside the value. */
  prev?: number
  color: string
  icon: LucideIcon
  /** Switched off or nothing recorded: an empty petal and a dash. */
  off?: boolean
}

/** An area's facets as petals, coloured by `color` from each area's accent. */
export const petalsOf = (
  facets: Facet[],
  color: (accent: Accent) => string,
): Petal[] =>
  facets.map((f) => ({
    key: f.key,
    label: f.label,
    value: finite(f.value) * 100,
    prev: finite(f.prev) * 100,
    color: color(AREA[f.module].accent),
    icon: AREA_ICONS[f.module],
    off: f.off,
  }))

export interface RosetteInk {
  ink: string
  muted: string
  good: string
  bad: string
  /** Sprout green: buds, sprigs, the wreath and the mark at 90+. */
  mark: string
  /** The hub behind the mark, the ground the flower sits on. */
  hub: string
}

const W = 312
const r1 = (n: number) => Math.round(n * 10) / 10
/** A rate as a whole number, 0 to 100, never NaN. */
export const rateOf = (v: number | undefined) =>
  Math.max(0, Math.min(100, Math.round(finite(v))))

export type PetalTier = "grow" | "bud" | "full"
export type FlowerTier = "grow" | "all90" | "all100"
export const petalTier = (value: number): PetalTier => {
  const v = rateOf(value)
  return v >= 100 ? "full" : v >= 90 ? "bud" : "grow"
}
/** Areas that are off do not hold the flower back, and an all-off flower
 * has earned nothing. */
export function flowerTier(petals: Petal[]): FlowerTier {
  const on = petals.filter((p) => !p.off)
  if (!on.length) return "grow"
  if (on.every((p) => rateOf(p.value) >= 100)) return "all100"
  if (on.every((p) => rateOf(p.value) >= 90)) return "all90"
  return "grow"
}

/** A spiral curling in from (x, y) heading at `angle`; dir 1 is clockwise. */
function curl(
  x0: number,
  y0: number,
  angle0: number,
  step0: number,
  dir = 1,
  n = 16,
  turn = 0.42,
) {
  let x = x0,
    y = y0,
    angle = angle0,
    step = step0
  const P: Point[] = [[x, y]]
  for (let i = 0; i < n; i++) {
    angle += dir * turn
    step *= 0.88
    x += Math.cos(angle) * step
    y += Math.sin(angle) * step
    P.push([x, y])
  }
  return smooth(P)
}
/** A frond bent along a circle from a0 to a1: two of these make a wreath. */
function arcFrond(
  cx: number,
  cy: number,
  R: number,
  a0: number,
  a1: number,
  n: number,
  seed: number,
) {
  const random = rng(seed),
    N = 24,
    P: Point[] = [],
    dir = Math.sign(a1 - a0),
    tanAt = (a: number) => a + (dir * Math.PI) / 2
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N
    P.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R])
  }
  let d = smooth(jitter(P, R * 0.012, random))
  const e = P[N]
  d += ` ${curl(e[0], e[1], tanAt(a1), R * 0.07, dir, 12, 0.5)}`
  for (let k = 0; k < n; k++) {
    const t = 0.06 + (k / n) * 0.86,
      a = a0 + (a1 - a0) * t,
      side = k % 2 ? 1 : -1,
      L = 6 * (1 - t * 0.4) * (0.85 + random() * 0.3)
    d += ` ${leaf(cx + Math.cos(a) * R, cy + Math.sin(a) * R, L, tanAt(a) - dir * side * 0.85, 0.4)}`
  }
  return d
}

export interface PetalShape {
  key: string
  tier: PetalTier
  outline: string
  fill: string
  /** The bud's curl at 90+, or the three-leaf sprig at 100. */
  bud?: string
  sprig?: string
  tip: Point
  label: Point
  side: "left" | "right" | "centre"
}
/** Where the tip labels sit, in drawing units: how wide a side label is,
 * how far it starts from its tip across and along, and the room a top or
 * bottom label needs past its tip. ``none`` draws no labels. */
export interface LabelBox {
  width: number
  across: number
  along: number
  room: number
}
const STATS_LABELS: LabelBox = { width: 62, across: 16, along: 20, room: 34 }
export const NO_LABELS: LabelBox = { width: 0, across: 0, along: 0, room: 6 }
/** The flower's geometry in a 312-wide box of height `h`. Pure, so the tier
 * thresholds and the paths can be tested without rendering. */
export function rosetteShape(
  petals: Petal[],
  h: number,
  labels: number | LabelBox = STATS_LABELS,
) {
  const box =
      typeof labels === "number" ? { ...STATS_LABELS, width: labels } : labels,
    cx = W / 2,
    cy = h / 2,
    n = Math.max(1, petals.length),
    // A side label needs `box.width` units beside its tip; the petals
    // shorten until the widest one fits inside the drawing.
    side = Math.max(
      0.3,
      ...petals.map((_, k) =>
        Math.abs(Math.cos(-Math.PI / 2 + (k * 2 * Math.PI) / n)),
      ),
    ),
    R = Math.max(
      8,
      Math.min(h / 2 - box.room, (cx - 2 - box.width) / side - box.across),
    ),
    tier = flowerTier(petals)
  const shapes: PetalShape[] = petals.map((p, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / n,
      v = p.off ? 0 : rateOf(p.value),
      t = p.off ? "grow" : petalTier(v),
      tip: Point = [cx + Math.cos(a) * R, cy + Math.sin(a) * R],
      c = Math.cos(a)
    return {
      key: p.key,
      tier: t,
      outline: leaf(cx, cy, R, a, 0.3),
      fill: v > 0 ? leaf(cx, cy, R * (0.18 + (0.82 * v) / 100), a, 0.32) : "",
      ...(t === "full"
        ? {
            sprig: `${leaf(tip[0], tip[1], 10, a - 0.7, 0.45)} ${leaf(tip[0], tip[1], 10, a + 0.7, 0.45)} ${leaf(tip[0], tip[1], 8, a, 0.45)}`,
          }
        : t === "bud"
          ? { bud: curl(tip[0], tip[1], a, 4.2, 1, 9, 0.5) }
          : {}),
      tip,
      label: [cx + c * (R + box.across), cy + Math.sin(a) * (R + box.along)],
      side: c > 0.3 ? "right" : c < -0.3 ? "left" : "centre",
    }
  })
  const hubR = tier === "all100" ? 20 : tier === "all90" ? 17 : 15
  return {
    cx,
    cy,
    R,
    tier,
    petals: shapes,
    hubR,
    wreath:
      tier === "all100"
        ? `${arcFrond(cx, cy, R + 5, Math.PI / 2 + 0.25, Math.PI * 1.5 - 0.1, 16, 21)} ${arcFrond(cx, cy, R + 5, Math.PI / 2 - 0.25, -Math.PI / 2 + 0.1, 16, 22)}`
        : "",
  }
}

/** One label for the whole flower: each area and its value. */
export function rosetteLabel(petals: Petal[]) {
  return `Score by area: ${petals
    .map((p) => {
      if (p.off) return `${p.label} off`
      const v = rateOf(p.value),
        dl = p.prev === undefined ? 0 : v - rateOf(p.prev)
      return `${p.label} ${v}${dl ? `, ${dl > 0 ? "up" : "down"} ${Math.abs(dl)}` : ""}`
    })
    .join(", ")}`
}

/** A layer that blooms in: drawn from its first frame at 70% and growing to
 * full size. Under Reduce Motion it fades up from 60% instead of growing. */
function Bloom({ children, style }: { children: ReactNode; style: object }) {
  const reduced = useReducedMotion(),
    s = useSharedValue(reduced ? 0.6 : 0.7)
  useEffect(() => {
    s.value = withTiming(1, {
      duration: 240,
      reduceMotion: ReduceMotion.Never,
    })
  }, [s])
  const anim = useAnimatedStyle(() =>
    reduced ? { opacity: s.value } : { transform: [{ scale: s.value }] },
  )
  return (
    <Animated.View pointerEvents="none" style={[style, anim]}>
      {children}
    </Animated.View>
  )
}
/** The full petals' glow, three pulses once the whole flower is at 100.
 * Only opacity, so it plays under Reduce Motion as well. */
function Glow({ children }: { children: ReactNode }) {
  const o = useSharedValue(0)
  useEffect(() => {
    const never = ReduceMotion.Never
    o.value = withDelay(
      300,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 800, reduceMotion: never }),
          withTiming(0, { duration: 800, reduceMotion: never }),
        ),
        3,
        false,
        undefined,
        never,
      ),
      never,
    )
  }, [o])
  const anim = useAnimatedStyle(() => ({ opacity: o.value }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", inset: 0 }, anim]}
    >
      {children}
    </Animated.View>
  )
}

/** A card's tip labels at ``fontU`` drawing units: the icon and the value
 * (no change, the card's hero carries that). */
export function cardLabels(fontU: number, padU = 8): LabelBox {
  const row = fontU * 1.3 + padU
  return {
    width: fontU * 3.3,
    across: fontU * 0.5 + 4,
    along: row / 2 + fontU * 0.4 + 4,
    room: row + fontU * 0.4 + 6,
  }
}
/** Below this petal length (in drawing units) labels crowd the flower, so a
 * card draws it bare instead: bigger, with the card's own line naming the
 * strongest and weakest area. */
export const MIN_LABELLED_R = 44

export function Rosette({
  petals,
  ink,
  height = 220,
  selected,
  onSelect,
  font: fontSize,
  card = false,
  halo,
  shadow,
}: {
  petals: Petal[]
  ink: RosetteInk
  /** The flower's height in the 312-wide drawing; it scales to its width. */
  height?: number
  selected?: string | null
  /** Makes each tip a button that picks its area. */
  onSelect?: (key: string) => void
  /** The value's size in points; by default it scales with the drawing. */
  font?: number
  /** Share artwork: Geist values with no change, sized and placed from
   * ``font``, and no labels when they would crowd the petals. */
  card?: boolean
  /** A soft ground behind the flower and its labels (a photo card). */
  halo?: string
  /** A shadow under the values alone, with no ground (a card on a photo
   * whose scrim already darkens it). */
  shadow?: string
}) {
  const [width, setWidth] = useState(0),
    haloId = `halo${useId().replace(/[^a-zA-Z0-9]/g, "")}`,
    k = width / W,
    // The labels are sized to the drawing, as the share kit sizes them.
    font = fontSize ?? Math.max(9, 12.5 * k),
    labelled = card && k > 0 ? cardLabels(font / k, 8 / k) : null,
    bare =
      card &&
      (!labelled || rosetteShape(petals, height, labelled).R < MIN_LABELLED_R),
    // A label set larger than that takes more of the drawing's width.
    shape = rosetteShape(
      petals,
      height,
      bare
        ? NO_LABELS
        : (labelled ?? (k > 0 ? Math.max(62, (62 * font) / (12.5 * k)) : 62)),
    ),
    { cx, cy, hubR, tier } = shape,
    icon = Math.round(font * 1.1),
    pct = (x: number, of: number) => `${(x / of) * 100}%` as const,
    mk = (hubR * 1.55) / 24,
    on90 = tier !== "grow",
    markColor = on90 ? ink.mark : ink.ink
  const markPaths = (
    <G
      transform={`translate(${r1(cx - 12 * mk)} ${r1(cy - 12 * mk)}) scale(${mk.toFixed(3)})`}
    >
      {FERN_PATHS.map((d) => (
        <Path
          key={d}
          d={d}
          fill="none"
          stroke={markColor}
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </G>
  )
  const box = `0 0 ${W} ${height}`,
    layer = { position: "absolute", inset: 0 } as const
  return (
    <View
      testID="rosette"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ width: "100%", aspectRatio: W / height }}
    >
      {!!halo && (
        <Svg
          width="100%"
          height="100%"
          viewBox={box}
          style={layer}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient id={haloId} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={halo} stopOpacity={0.82} />
              <Stop offset="0.7" stopColor={halo} stopOpacity={0.62} />
              <Stop offset="1" stopColor={halo} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Ellipse
            cx={cx}
            cy={cy}
            rx={W / 2}
            ry={height / 2}
            fill={`url(#${haloId})`}
          />
        </Svg>
      )}
      {tier === "all100" && (
        <Bloom key="ring" style={layer}>
          <Svg width="100%" height="100%" viewBox={box}>
            <Path
              d={shape.wreath}
              fill="none"
              stroke={ink.mark}
              strokeWidth={1.3}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.75}
            />
          </Svg>
        </Bloom>
      )}
      {/* The drawing carries the one label; the tips stay their own
          buttons beside it. */}
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={rosetteLabel(petals)}
        style={layer}
      >
        <Svg width="100%" height="100%" viewBox={box}>
          {shape.petals.map((s, i) => {
            const p = petals[i],
              lit = s.tier !== "grow"
            return (
              <G key={s.key} opacity={p.off ? 0.4 : 1}>
                <Path
                  d={s.outline}
                  fill="none"
                  stroke={lit ? p.color : ink.muted}
                  strokeWidth={s.key === selected ? 2 : 1}
                  strokeDasharray={on90 ? undefined : "2 4"}
                  opacity={lit ? 0.9 : 0.7}
                />
                {s.fill ? (
                  <Path
                    d={s.fill}
                    fill={p.color}
                    fillOpacity={s.tier === "full" ? 1 : 0.85}
                    stroke={p.color}
                    strokeWidth={1.2}
                    strokeLinejoin="round"
                  />
                ) : null}
                {s.bud ? (
                  <Path
                    d={s.bud}
                    fill="none"
                    stroke={ink.mark}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                  />
                ) : null}
              </G>
            )
          })}
          <Circle
            cx={cx}
            cy={cy}
            r={hubR}
            fill={ink.hub}
            stroke={on90 ? ink.mark : ink.muted}
            strokeWidth={on90 ? 1.4 : 0.8}
            strokeOpacity={on90 ? 0.9 : 0.5}
          />
          {tier !== "all100" && markPaths}
        </Svg>
      </View>
      {tier === "all100" && (
        <Glow key="glow">
          <Svg width="100%" height="100%" viewBox={box}>
            {shape.petals.map((s) =>
              s.fill ? (
                <Path
                  key={s.key}
                  d={s.fill}
                  fill="none"
                  stroke={ink.mark}
                  strokeWidth={5}
                  strokeOpacity={0.45}
                  strokeLinejoin="round"
                />
              ) : null,
            )}
          </Svg>
        </Glow>
      )}
      {tier === "all100" && (
        <Bloom key="mark" style={layer}>
          <Svg width="100%" height="100%" viewBox={box}>
            {markPaths}
          </Svg>
        </Bloom>
      )}
      {shape.petals.map((s) =>
        s.sprig ? (
          // Each sprig blooms about its own tip.
          <Bloom
            key={`sprig-${s.key}`}
            style={{
              position: "absolute",
              left: pct(s.tip[0] - 14, W),
              top: pct(s.tip[1] - 14, height),
              width: pct(28, W),
              height: pct(28, height),
            }}
          >
            <Svg
              width="100%"
              height="100%"
              viewBox={`${r1(s.tip[0] - 14)} ${r1(s.tip[1] - 14)} 28 28`}
            >
              <Path
                d={s.sprig}
                fill={ink.mark}
                stroke={ink.mark}
                strokeWidth={0.8}
                strokeLinejoin="round"
              />
            </Svg>
          </Bloom>
        ) : null,
      )}
      {shape.petals.map((s, i) => {
        if (bare) return null
        const p = petals[i],
          v = rateOf(p.value),
          dl = card || p.off || p.prev === undefined ? 0 : v - rateOf(p.prev),
          Icon = p.icon,
          row = (
            <>
              <Icon
                size={icon}
                color={p.off ? ink.muted : p.color}
                strokeWidth={2}
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                adjustsFontSizeToFit={!card}
                minimumFontScale={0.6}
                style={{
                  fontFamily: card ? fonts.semibold : fonts.mono,
                  fontSize: font,
                  lineHeight: font * 1.25,
                  color: p.off ? ink.muted : ink.ink,
                  ...(card
                    ? {
                        fontVariant: ["tabular-nums" as const],
                        letterSpacing: -0.02 * font,
                      }
                    : {}),
                  ...(halo || shadow
                    ? {
                        textShadowColor: shadow ?? halo,
                        textShadowRadius: font * 0.4,
                      }
                    : {}),
                }}
              >
                {p.off ? "—" : v}
                {dl !== 0 && (
                  <Text
                    style={{
                      color: dl > 0 ? ink.good : ink.bad,
                      fontSize: font * 0.85,
                    }}
                  >
                    {` ${dl > 0 ? "▲" : "▼"}${Math.abs(dl)}`}
                  </Text>
                )}
              </Text>
            </>
          ),
          rowH = Math.max(icon, font * 1.3) + 8,
          // Left labels end at the petal, right ones start there, top and
          // bottom centre on the axis.
          place =
            s.side === "left"
              ? { right: pct(W - s.label[0], W) }
              : s.side === "right"
                ? { left: pct(s.label[0], W) }
                : { left: pct(s.label[0] - 60, W), width: pct(120, W) },
          style = {
            position: "absolute" as const,
            top: pct(s.label[1], height),
            marginTop: -rowH / 2,
            height: rowH,
            ...place,
            flexDirection: "row" as const,
            justifyContent:
              s.side === "left"
                ? ("flex-end" as const)
                : s.side === "right"
                  ? ("flex-start" as const)
                  : ("center" as const),
            alignItems: "center" as const,
          }
        return onSelect ? (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={`${p.label}: ${p.off ? "off" : v}. Show details`}
            accessibilityState={{ selected: s.key === selected }}
            hitSlop={8}
            onPress={() => onSelect(s.key)}
            style={style}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 6,
                height: rowH,
                borderRadius: rowH / 2,
                borderWidth: 1,
                borderColor: s.key === selected ? p.color : "transparent",
              }}
            >
              {row}
            </View>
          </Pressable>
        ) : (
          <View
            key={s.key}
            style={[style, { gap: 4 * k }]}
            importantForAccessibility="no-hide-descendants"
          >
            {row}
          </View>
        )
      })}
    </View>
  )
}
