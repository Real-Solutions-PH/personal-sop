import type { HostInstance, ScrollViewInstance } from "react-native"
// Share cards (ADR-0019, ADR-0028, ADR-0032; the anatomy is the card library,
// docs/brand/unfurl-card-library.pdf): a gradient, paper or ink ground with
// the hand-drawn nature motif behind it at about a fifth of its strength, the
// date at the top, then a title, a hero figure with its change, a win or a
// miss line, a chart and a few unboxed figures, and the flat Unfurl lockup in
// the footer. No boxes, chips, kicker or accent bar. Numbers are Geist 600
// with tabular figures. Gradients are allowed here, on the exported
// artwork's ground (`CardGround`), and nowhere in the interface. Every size
// is a fraction of the card's width (`q` = 1% of it; the kit's points are
// 1/360 of it), so a card reads the same at 180 pt in the privacy check and
// at 1080 px in the exported PNG.

import { palette } from "@domain/design/tokens"
import * as Sharing from "expo-sharing"
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  Copy as CopyIcon,
  Download,
  Ellipsis,
  Image as ImageIcon,
  ImagePlus,
  Palette,
  PlusCircle,
  Sticker,
} from "lucide-react-native"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  Image,
  PixelRatio,
  Platform,
  ScrollView,
  Share,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import { toast } from "sonner-native"
import { LineTrack } from "./brand/line"
import { jitter, type Point, rng, smooth } from "./brand/scribble"
import { ColorPicker, luminance } from "./color-picker"
import { useShown } from "./extras"
import { copyText, pickPhoto } from "./media"
import { Copy, Line, Segmented, Tap } from "./native-kit"
import { go } from "./navigation"
import {
  type DecoKind,
  decoHeight,
  decoPath,
  ribLeaf,
  SPRIG,
} from "./share-deco"
import { fmt } from "./share-format"
import { CENTRED, frameRatio } from "./social/crop"
import { framePhoto, keep, prepareImage } from "./social/media"
import { addStory, type Media, setPostDraft } from "./social/store"
import { type Accent, fonts, useTheme } from "./theme"
import { Button, Field, Sheet } from "./ui"
import { logUsage } from "./usage"

export type CardFormat = "9:16" | "4:5" | "1:1"
// Photo leads: a card on the person's own picture is the one most shared.
const BACKDROPS = [
  { key: "photo", label: "Photo" },
  { key: "fern", label: "Fern" },
  { key: "dusk", label: "Dusk" },
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "custom", label: "Colour" },
  { key: "sticker", label: "Sticker" },
] as const
export type CardBackdrop = (typeof BACKDROPS)[number]["key"]
export type CardLook = {
  format: CardFormat
  backdrop: CardBackdrop
  photo: string | null
  /** The Colour background (``#rrggbb``), picked by the person. */
  color?: string
}
export const ratioOf = (format: CardFormat) =>
  format === "9:16" ? 16 / 9 : format === "4:5" ? 5 / 4 : 1

/** ``hex`` (3, 6 or 8 digits) at ``opacity``, as ``#rrggbbaa``. Short hex
 * is expanded first: ``"#fff" + "a6"`` is not a colour. */
export function alpha(hex: string, opacity: number): string {
  let h = hex.replace("#", "")
  if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join("")
  const base = h.length === 8 ? Number.parseInt(h.slice(6), 16) / 255 : 1
  const a = Math.round(Math.max(0, Math.min(1, base * opacity)) * 255)
  return `#${h.slice(0, 6)}${a.toString(16).padStart(2, "0")}`
}

type Tokens = (typeof palette)["light" | "dark"]
/** The colours one card is drawn with: theme tokens for its ground. */
export type CardInk = {
  dark: boolean
  /** Card ground; ``transparent`` for the sticker. */
  bg: string
  /** A faint fill on the ground (the profile's initials). */
  panel: string
  line: string
  ink: string
  muted: string
  /** Empty part of a meter, a dotted track. */
  track: string
  /** The logo mark and the nature line: moss on paper, sprout on dark
   * (docs/brand Logos). */
  mark: string
  good: string
  bad: string
  area: (a: Accent) => string
  /** A gradient ground (share artwork only, ADR-0028): its stops from the
   * top-left corner to the bottom-right. ``bg`` is the first stop. */
  gradient?: { stops: string[] }
  /** On a photo: the shadow under every word and number, so text holds on
   * any picture without a box behind it. */
  shadow?: string
}
/** The stops of each gradient ground. Fern stops at moss: a lighter stop
 * (``frond``) or a sprout glow drops ink and muted text below 4.5:1. */
const GRADIENTS: Partial<Record<CardBackdrop, string[]>> = {
  fern: [palette.dark.background, palette.light.moss],
  dusk: [
    palette.light["hero-from"],
    palette.light["hero-via"],
    palette.light["hero-to"],
  ],
}
export function cardInk(look: CardLook): CardInk {
  const custom = look.backdrop === "custom" ? (look.color ?? null) : null
  // A Photo ground with no photo chosen yet is drawn on Fern, so the card
  // still looks finished until one is picked.
  const stops =
    GRADIENTS[look.backdrop] ??
    (look.backdrop === "photo" && !look.photo ? GRADIENTS.fern : undefined)
  const dark =
    look.backdrop === "light" ? false : custom ? luminance(custom) <= 0.4 : true
  const p: Tokens = palette[dark ? "dark" : "light"]
  const see = look.backdrop === "photo" || look.backdrop === "sticker"
  const onPhoto = look.backdrop === "photo"
  const tinted = !!custom || see || !!stops
  return {
    dark,
    ...(stops ? { gradient: { stops } } : {}),
    ...(onPhoto ? { shadow: alpha(palette.dark.background, 0.6) } : {}),
    bg:
      stops?.[0] ??
      custom ??
      (look.backdrop === "sticker" ? alpha(p.background, 0.72) : p.background),
    panel: tinted ? alpha(p.foreground, dark ? 0.1 : 0.07) : p.card,
    line: tinted ? alpha(p.foreground, 0.14) : p.border,
    ink: p.foreground,
    // On a photo, muted text stays nearer full ink: the picture under the
    // scrim varies, and 0.78 of it can sink into a bright patch.
    muted: onPhoto
      ? alpha(p.foreground, 0.88)
      : tinted
        ? alpha(p.foreground, 0.78)
        : p["muted-foreground"],
    track: alpha(p.foreground, dark ? 0.16 : 0.1),
    mark: stops ? palette.light.sprout : dark ? p.sprout : p.primary,
    good: p.good,
    bad: p.bad,
    // A chosen colour can sit right on an area's own (purple on the habits
    // purple): below 3:1, the graphics minimum, that area draws in ink.
    area: (a) => (custom && contrast(p[a], custom) < 3 ? p.foreground : p[a]),
  }
}
/** The WCAG contrast ratio of two ``#rrggbb`` colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** One kit point: the card library draws on a 360-wide canvas, and its sizes
 * are given here in those points, as a share of ``q``. */
export const P = 100 / 360

const CardContext = createContext<{
  q: number
  c: CardInk
  f: CardFormat
  /** The smallest a line of words may be drawn, in ``q``: on a photo the
   * data is drawn smaller, and its captions stop at a readable floor. */
  floor?: number
}>({
  q: 1,
  c: cardInk({ format: "9:16", backdrop: "dark", photo: null }),
  f: "9:16",
})
/** The text shadow that keeps words legible on a photo; none elsewhere. */
function shadowOf(c: CardInk, px: number) {
  return c.shadow
    ? {
        textShadowColor: c.shadow,
        textShadowOffset: { width: 0, height: px * 0.08 },
        textShadowRadius: px * 0.22,
      }
    : null
}
/** Where a composer wants the node it exports: the card without its
 * on-screen rounding and border. */
const CardShotContext = createContext<
  ((v: HostInstance | null) => void) | undefined
>(undefined)
/** The open card's scale, colours and shape, for the pieces below. */
export const useCard = () => useContext(CardContext)

// ---------- The fit rule ----------
// A card that runs out of room drops content in one order, never shrinking
// the title or the hero: list rows first (counted into "+N more", down to
// two), then the sub line, the figures, the win line, the chart's optional
// parts, the last list rows, and the chart itself last.
type Drop = "sub" | "figures" | "win" | "opt" | "chart"
const STAGE: Record<Drop, number> = {
  sub: 1,
  figures: 2,
  win: 3,
  opt: 4,
  chart: 6,
}
const DROP_AT: Partial<Record<number, Drop>> = {
  1: "sub",
  2: "figures",
  3: "win",
  4: "opt",
  6: "chart",
}
type Fit = { stage: number; rows: number }
type FitParts = Map<Drop | "rows", number>
/** The next step of the rule from ``f``, skipping kinds the card lacks so
 * that every step changes the layout. */
export function nextFit(f: Fit, parts: FitParts): Fit {
  const left = (parts.get("rows") ?? 0) - f.rows
  if (f.stage === 0 && left > 2) return { ...f, rows: f.rows + 1 }
  if (f.stage === 5 && left > 1) return { ...f, rows: f.rows + 1 }
  for (let s = f.stage + 1; s <= 6; s++) {
    if (s === 5) {
      if (left > 1) return { stage: 5, rows: f.rows + 1 }
      continue
    }
    const kind = DROP_AT[s]
    if (kind && (parts.get(kind) ?? 0) > 0) return { ...f, stage: s }
  }
  return f
}
/** How long a layout must hold still before the fit rule reads it. */
export const FIT_SETTLE_MS = 120
const FitContext = createContext<{
  fit: Fit
  part: (kind: Drop | "rows", n: number) => () => void
  measure: (which: "box" | "inner", height: number) => void
}>({ fit: { stage: 0, rows: 0 }, part: () => () => {}, measure: () => {} })
/** Whether a droppable part has been dropped by the fit rule. */
function useDrop(kind: Drop) {
  const { fit, part } = useContext(FitContext)
  useEffect(() => part(kind, 1), [part, kind])
  return fit.stage >= STAGE[kind]
}
/** How many of a list's ``n`` rows still fit. */
function useRows(n: number) {
  const { fit, part } = useContext(FitContext)
  useEffect(() => part("rows", n), [part, n])
  return Math.max(
    fit.stage >= 5 ? Math.min(n, 1) : Math.min(n, 2),
    n - fit.rows,
  )
}

/** A number in Geist 600 with tabular figures that shrinks to fit its line
 * rather than clip or wrap; its unit rides on the same line. */
export function Num({
  children,
  size,
  unit,
  unitSize,
  color,
  align = "left",
  spacing = -0.02,
}: {
  children: string
  size: number
  unit?: string
  /** The unit's size in ``q``; about 40% of the number by default. */
  unitSize?: number
  color?: string
  align?: "left" | "center" | "right"
  /** Letter spacing as a share of the size (the hero sets −0.045). */
  spacing?: number
}) {
  const { q, c } = useCard()
  const glued = !!unit && /^[%×/]/.test(unit)
  const shade = shadowOf(c, size * q)
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.3}
      allowFontScaling={false}
      style={{
        fontFamily: fonts.semibold,
        fontSize: size * q,
        lineHeight: size * q * 1.18,
        letterSpacing: spacing * size * q,
        color: color ?? c.ink,
        textAlign: align,
        fontVariant: ["tabular-nums"],
        ...shade,
      }}
    >
      {children}
      {unit ? (
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: (unitSize ?? Math.max(3.4, size * 0.4)) * q,
            letterSpacing: -0.03 * (unitSize ?? size * 0.4) * q,
            color: c.muted,
          }}
        >
          {glued ? unit : ` ${unit}`}
        </Text>
      ) : null}
    </Text>
  )
}

/** Words in Geist: names, titles and verdicts. Long ones wrap to ``lines``
 * then shrink a little, then end in an ellipsis; they never spill. */
export function Words({
  children,
  size = 3.8,
  weight = "body",
  color,
  lines = 2,
  align = "left",
  muted = false,
}: {
  children: ReactNode
  size?: number
  weight?: "body" | "medium" | "semibold"
  color?: string
  lines?: number
  align?: "left" | "center" | "right"
  muted?: boolean
}) {
  const { q, c, floor } = useCard(),
    px = Math.max(size, floor ?? 0) * q
  return (
    <Text
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      allowFontScaling={false}
      ellipsizeMode="tail"
      style={{
        fontFamily: fonts[weight],
        fontSize: px,
        lineHeight: px * (size >= 8 ? 1.1 : 1.3),
        letterSpacing: size >= 5 ? -0.02 * px : 0,
        color: color ?? (muted ? c.muted : c.ink),
        textAlign: align,
        ...shadowOf(c, px),
      }}
    >
      {children}
    </Text>
  )
}

/** A small muted caption under or beside a value, in sentence case. */
export function Label({
  children,
  align,
  color,
}: {
  children: ReactNode
  align?: "left" | "center" | "right"
  color?: string
}) {
  return (
    <Words
      size={12 * P}
      weight="medium"
      lines={1}
      align={align}
      color={color}
      muted
    >
      {children}
    </Words>
  )
}

/** What the card is about: a habit, a workout, a lift. Never dropped. */
export function Title({ children }: { children: ReactNode }) {
  const { f } = useCard()
  return (
    <Words size={(f === "9:16" ? 28 : 20) * P} weight="semibold" lines={2}>
      {children}
    </Words>
  )
}

/** A change in words, coloured by what it means and led by an arrow, never
 * colour alone: green for a gain, red for what it cost. No outline. */
export function Change({
  good,
  children,
}: {
  good: boolean
  children: string
}) {
  const { q, c } = useCard(),
    tone = good ? c.good : c.bad,
    Icon = good ? ArrowUp : ArrowDown
  return (
    <View
      testID={good ? "card-gain" : "card-cost"}
      style={{ flexDirection: "row", alignItems: "center", gap: 3 * P * q }}
    >
      <Icon size={15 * P * q} color={tone} strokeWidth={2.4} />
      <View style={{ flexShrink: 1 }}>
        <Words size={15 * P} weight="medium" lines={1} color={tone}>
          {children}
        </Words>
      </View>
    </View>
  )
}
/** A change as a number: "8% vs last push", "7.5 kg vs best". Its sign
 * picks the arrow and colour unless ``good`` says otherwise (more calories
 * than planned is a cost). */
export function Delta({
  n,
  unit = "",
  suffix,
  good,
}: {
  n: number | null | undefined
  unit?: string
  suffix: string
  good?: boolean
}) {
  if (n == null || !Number.isFinite(n) || n === 0) return null
  return (
    <Change good={good ?? n > 0}>
      {`${fmt(Math.abs(n), 6, Math.abs(n) % 1 ? 1 : 0)}${unit} ${suffix}`}
    </Change>
  )
}

/** The hero figure: the one number the card is about, with its change
 * beside it. A unit longer than a word goes on its own line under it. */
export function Hero({
  value,
  unit,
  delta,
  small,
}: {
  value: string
  unit?: string
  delta?: ReactNode
  /** A long unit line or a crowded card: the smaller tier. */
  small?: boolean
}) {
  const { q, f, floor } = useCard(),
    tier = small || value.length >= 7 ? 2 : value.length >= 5 ? 1 : 0,
    // On a photo a story's hero takes the post size: the block stays
    // compact and the picture keeps the room.
    size =
      f === "9:16" && floor === undefined
        ? [96, 76, 56][tier]
        : f === "1:1"
          ? [56, 56, 44][tier]
          : [64, 64, 48][tier],
    wide = !!unit && unit.length > 6
  return (
    <View testID="card-hero" style={{ gap: 4 * P * q }}>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "flex-end",
          columnGap: 10 * P * q,
          rowGap: 4 * P * q,
        }}
      >
        <View style={{ flexShrink: 1, maxWidth: "100%" }}>
          <Num
            size={size * P}
            unit={wide ? undefined : unit}
            unitSize={(f === "9:16" ? 32 : 26) * P}
            spacing={-0.045}
          >
            {value}
          </Num>
        </View>
        {delta ? (
          <View style={{ paddingBottom: size * 0.16 * P * q, flexShrink: 1 }}>
            {delta}
          </View>
        ) : null}
      </View>
      {wide && (
        <Words
          size={(f === "9:16" ? 20 : 17) * P}
          weight="medium"
          lines={2}
          muted
        >
          {unit}
        </Words>
      )}
    </View>
  )
}

/** The small hand-drawn sprig that marks a win or a record. */
function Sprig({ size }: { size: number }) {
  const { c } = useCard()
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={SPRIG}
        fill="none"
        stroke={c.mark}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
/** A win, said plainly beside a sprig: "Longest streak yet". */
export function Win({ children }: { children: string }) {
  const { q } = useCard(),
    hidden = useDrop("win")
  if (hidden) return null
  return (
    <View
      testID="card-win"
      style={{ flexDirection: "row", alignItems: "center", gap: 6 * P * q }}
    >
      <Sprig size={20 * P * q} />
      <View style={{ flexShrink: 1 }}>
        <Words size={15 * P} weight="medium" lines={2}>
          {children}
        </Words>
      </View>
    </View>
  )
}
/** One quiet line of context; a miss is said in the miss colour. */
export function Sub({
  children,
  bad = false,
}: {
  children: string
  bad?: boolean
}) {
  const { c } = useCard(),
    hidden = useDrop("sub")
  if (hidden) return null
  return (
    <View testID={bad ? "card-miss" : "card-sub"}>
      <Words size={14 * P} lines={2} color={bad ? c.bad : undefined} muted>
        {children}
      </Words>
    </View>
  )
}

/** A few figures in a row, unboxed: the number over its label. */
export function Figures({
  items,
}: {
  items: { label: string; value: string; unit?: string }[]
}) {
  const { q } = useCard(),
    hidden = useDrop("figures")
  if (hidden || !items.length) return null
  return (
    <View
      testID="card-figures"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        columnGap: 22 * P * q,
        rowGap: 4 * P * q,
      }}
    >
      {items.map((x) => (
        <View key={x.label} style={{ minWidth: 0, maxWidth: "100%" }}>
          <Num size={18 * P} unit={x.unit} unitSize={18 * P}>
            {x.value}
          </Num>
          <Label>{x.label}</Label>
        </View>
      ))}
    </View>
  )
}

/** The chart's place: it takes the room left between the figures above and
 * below and tells the fit rule when what it holds is taller than that. */
export function Body({
  children,
  end = false,
  fill = false,
}: {
  children: ReactNode
  /** Sit on the bottom of the room (charts), not the top (lists). */
  end?: boolean
  /** Hand the whole room to a chart that sizes itself to it (the leaf
   * flower), so it grows into it rather than being dropped. */
  fill?: boolean
}) {
  const { q, floor } = useCard(),
    { measure } = useContext(FitContext),
    hidden = useDrop("chart"),
    // On a photo the block hugs the foot of the card: the chart's room is
    // its own height (shrinking first when the block runs out of room),
    // not all the room left, so no gap opens above a short chart.
    hug = floor !== undefined && !fill,
    [own, setOwn] = useState(0),
    // The box's last laid-out height, held while it is not yet reported.
    box = useRef(0)
  // Once a hugging box knows its chart's height, report the box as it last
  // laid out: if the block left it no room it stays 0, and no new layout
  // would ever report that.
  // biome-ignore lint/correctness/useExhaustiveDependencies: report once own is known
  useEffect(() => {
    if (hug && own > 0) measure("box", box.current)
  }, [hug, own > 0])
  if (hidden) return null
  return (
    <View
      testID="card-body"
      style={
        hug
          ? { height: own, flexShrink: 1, minHeight: 0, overflow: "hidden" }
          : { flex: 1, minHeight: 0, overflow: "hidden" }
      }
      onLayout={(e) => {
        box.current = e.nativeEvent.layout.height
        // A hugging box is 0 until it knows its chart's height: that first
        // pass is not an overflow, so it waits for the effect above.
        if (hug && own === 0) return
        measure("box", box.current)
      }}
    >
      <View
        testID="card-body-fit"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          ...(fill ? { top: 0, bottom: 0 } : end ? { bottom: 0 } : { top: 0 }),
          gap: 6 * P * q,
        }}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height
          setOwn((v) => (Math.abs(v - h) < 0.5 ? v : h))
          measure("inner", h)
        }}
      >
        {children}
      </View>
    </View>
  )
}
/** A part of a chart that may go before the chart does (a route, a
 * legend). */
export function Optional({ children }: { children: ReactNode }) {
  const hidden = useDrop("opt")
  return hidden ? null : children
}
/** The line under a chart: what it shows, and its range. */
export function ChartNote({
  left,
  right,
  bad = false,
}: {
  left?: string
  right?: string
  /** The left part is a miss ("4 missed: …"). */
  bad?: boolean
}) {
  const { q, c } = useCard()
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        gap: 8 * P * q,
      }}
    >
      <View style={{ flexShrink: 1 }}>
        {!!left && <Label color={bad ? c.bad : undefined}>{left}</Label>}
      </View>
      <View style={{ flexShrink: 1 }}>
        {!!right && <Label align="right">{right}</Label>}
      </View>
    </View>
  )
}

/** A chart's canvas: 312 kit points wide (the content width), ``h`` tall,
 * one unit per point. */
function Viz({
  h,
  label,
  children,
}: {
  h: number
  label: string
  children: ReactNode
}) {
  const { q } = useCard(),
    p = P * q
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={312 * p} height={h * p} viewBox={`0 0 312 ${h}`}>
        {children}
      </Svg>
    </View>
  )
}
function VizText({
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
    // On a photo a chart's words grow toward the caption floor (in drawing
    // units, capped so stem labels keep clear of each other) and draw over
    // a soft outline of the shadow colour: SVG text takes no text shadow.
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
const f1 = (n: number) => Math.round(n * 10) / 10

/** Columns as hand-drawn stems, its value over each and its label under it.
 * A leaf grows on the stems that hit the mark; ``goal`` is a dashed line. A
 * ``null`` is a missed day, drawn as a cross in the miss colour; an
 * ``undefined`` is a day with nothing to show. */
export function Stems({
  values,
  labels,
  on,
  goal,
  leaf,
  missed,
  format = (v) => fmt(v),
  height,
  color,
  label,
}: {
  values: (number | null | undefined)[]
  labels?: string[]
  /** The column to bring forward (today, this week). */
  on?: number
  goal?: number
  leaf?: (v: number, i: number) => boolean
  /** Columns that missed the mark: their labels take the miss colour. */
  missed?: (v: number, i: number) => boolean
  format?: (v: number) => string
  height: number
  color: string
  label: string
}) {
  const { c } = useCard(),
    n = Math.max(1, values.length),
    slot = 312 / n,
    top = 18,
    bot = height - 18,
    max = Math.max(
      1,
      goal ?? 0,
      ...values.filter((v): v is number => v != null && v >= 0),
    ),
    y = (v: number) => bot - (v / max) * (bot - top - 10)
  return (
    <Viz h={height} label={label}>
      {goal ? (
        <Path
          d={`M0 ${f1(y(goal))} H312`}
          stroke={c.good}
          strokeWidth={1.2}
          strokeDasharray="4 4"
        />
      ) : null}
      {values.map((v, i) => {
        const x = f1(slot * i + slot / 2),
          lab = labels?.[i] ?? "",
          lit = on === undefined || i === on
        if (v === null)
          return (
            <G key={i}>
              <Path
                d={`M${x - 5} ${bot - 10} l10 10 m0 -10 l-10 10`}
                stroke={c.bad}
                strokeWidth={1.8}
                strokeLinecap="round"
              />
              <VizText x={x} y={height - 3} color={c.bad}>
                {lab}
              </VizText>
            </G>
          )
        if (v === undefined)
          return (
            <VizText key={i} x={x} y={height - 3} color={c.muted}>
              {lab}
            </VizText>
          )
        const yy = y(v),
          hit = leaf ? leaf(v, i) : false,
          miss = missed ? missed(v, i) : false
        return (
          <G key={i}>
            <Path
              d={smooth(
                jitter(
                  [
                    [x, bot],
                    [x + 0.8, (bot + yy) / 2],
                    [x, Math.min(bot - 0.5, yy)],
                  ],
                  1.4,
                  rng(i + 9),
                ),
              )}
              stroke={color}
              strokeWidth={Math.min(12, slot * 0.3)}
              strokeLinecap="round"
              fill="none"
              opacity={lit ? 1 : 0.5}
            />
            {hit ? (
              <Path
                d={ribLeaf(x, yy - 3, 11, i % 2 ? -1.0 : -2.15, 0.42, false)}
                fill={c.mark}
                stroke={c.mark}
                strokeWidth={0.8}
              />
            ) : null}
            <VizText
              x={x}
              y={f1(yy - (hit ? 16 : 8))}
              color={i === on ? c.ink : c.muted}
            >
              {format(v)}
            </VizText>
            <VizText
              x={x}
              y={height - 3}
              color={miss ? c.bad : i === on ? c.ink : c.muted}
            >
              {lab}
            </VizText>
          </G>
        )
      })}
    </Viz>
  )
}

/** One day on a card: done, partly done, not done, missed (a scheduled day
 * that went by undone), or before the start. */
export type Dot = "on" | "part" | "off" | "miss" | "none"
const hit = (d: Dot | undefined) => d === "on" || d === "part"
/** The run that a miss ended, when it was longer than the run since:
 * ``lost`` days, broken at index ``at``. Walking back from the newest cell
 * (today may still be open), ``breaks`` end a run and the other not-done
 * cells are passed over (a day the habit was not due). */
export function endedRun(
  cells: Dot[],
  breaks: Dot[] = ["miss"],
): { lost: number; at: number } | null {
  const pass = (d: Dot | undefined) =>
    hit(d) || (d === "off" && !breaks.includes("off"))
  let i = cells.length - 1
  if (i >= 0 && !hit(cells[i]) && cells[i] !== "miss") i -= 1
  let current = 0
  while (i >= 0 && pass(cells[i])) {
    if (hit(cells[i])) current += 1
    i -= 1
  }
  if (i < 0 || !breaks.includes(cells[i])) return null
  const at = i
  let lost = 0
  for (i -= 1; i >= 0 && pass(cells[i]); i -= 1) if (hit(cells[i])) lost += 1
  return lost > current ? { lost, at } : null
}
/** ``day`` (YYYY-MM-DD) moved by ``n`` days, at local noon. */
export function shiftDay(day: string, n: number) {
  const d = new Date(`${day}T12:00:00`)
  d.setDate(d.getDate() + n)
  const two = (v: number) => String(v).padStart(2, "0")
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}
/** A window of days, day first: "18–24 Oct", "28 Sep – 4 Oct". */
export function dayRange(from: string, to: string) {
  const d = (day: string) => new Date(`${day}T12:00:00`),
    a = d(from),
    b = d(to),
    month = (x: Date) => x.toLocaleDateString("en-GB", { month: "short" })
  return a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
    ? `${a.getDate()}–${b.getDate()} ${month(b)}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)}`
}
/** "Wed 28 Oct". */
export const dayName = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  })

const monday = (day: string) => (new Date(`${day}T12:00:00`).getDay() + 6) % 7
/** The last ``weeks`` whole weeks of ``cells`` (Monday to Sunday, the last
 * one ending with the newest cell), and the day the first one falls on. */
export function weekCells(cells: Dot[], start?: string, weeks?: number) {
  if (!weeks || !start) return { cells, start }
  const keep = Math.min(
    cells.length,
    weeks * 7 - (6 - monday(shiftDay(start, cells.length - 1))),
  )
  return {
    cells: cells.slice(cells.length - keep),
    start: shiftDay(start, cells.length - keep),
  }
}
/** A calendar of leaves, Monday first: filled for done, an outline for not
 * done, a red outline for missed, a dot before the start. ``start`` is the
 * first cell's day, which sets the weekday labels across the top. */
export function LeafCal({
  cells: all,
  start: first,
  weeks,
  rowH,
  color,
  label = "Calendar",
}: {
  cells: Dot[]
  start?: string
  /** Whole weeks to show, Monday to Sunday, ending with the last cell. */
  weeks?: number
  rowH: number
  color: string
  label?: string
}) {
  const { c } = useCard(),
    cols = 7,
    { cells, start } = weekCells(all, first, weeks),
    offset = start ? monday(start) : 0,
    rows = Math.ceil((cells.length + offset) / cols),
    cw = 312 / cols,
    top = start ? 18 : 2,
    h = top + rows * rowH,
    L = Math.min(cw * 0.62, rowH * 1.05)
  return (
    <Viz h={h} label={label}>
      {start
        ? [..."MTWTFSS"].map((l, i) => (
            <VizText key={i} x={f1(cw * i + cw / 2)} y={12} color={c.muted}>
              {l}
            </VizText>
          ))
        : null}
      {cells.map((d, k) => {
        const i = k + offset,
          cx = cw * (i % cols) + cw / 2 - L * 0.35,
          cy = top + Math.floor(i / cols) * rowH + rowH * 0.5 + L * 0.35
        if (d === "none")
          return (
            <Circle
              key={k}
              cx={f1(cx + L * 0.35)}
              cy={f1(cy - L * 0.35)}
              r={1.6}
              fill={c.muted}
              opacity={0.5}
            />
          )
        const leaf = ribLeaf(cx, cy, L, -0.8, 0.46, true)
        return d === "on" || d === "part" ? (
          <Path
            key={k}
            d={leaf}
            fill={d === "on" ? color : alpha(color, 0.45)}
            stroke={color}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        ) : (
          <Path
            key={k}
            testID={d === "miss" ? "leaf-missed" : undefined}
            d={leaf}
            fill="none"
            stroke={d === "miss" ? c.bad : c.muted}
            strokeWidth={d === "miss" ? 1.6 : 1}
            strokeLinejoin="round"
            opacity={d === "miss" ? 1 : 0.55}
          />
        )
      })}
    </Viz>
  )
}

/** A trend that grows like a vine (ADR-0032's hand-drawn line): leaves at
 * each point and a bud at the latest. ``best`` draws the previous best as a
 * dashed line. A still image: no reveal motion, it is captured. */
export function Spark({
  values,
  height,
  color,
  best,
  bestLabel,
  label = "Trend",
}: {
  values: number[]
  /** In kit points. */
  height: number
  color: string
  best?: number
  bestLabel?: string
  label?: string
}) {
  const { c } = useCard()
  if (values.length < 2) return null
  const hi = Math.max(...values, best ?? 0),
    lo = Math.min(...values),
    X = (i: number) => 6 + (i * 300) / (values.length - 1),
    Y = (v: number) => height - 8 - ((v - lo) / (hi - lo || 1)) * (height - 26),
    points = values.map((v, i): Point => [X(i), Y(v)]),
    d = smooth(points),
    last = points[points.length - 1]
  return (
    <Viz h={height} label={label}>
      {best !== undefined ? (
        <G>
          <Path
            d={`M6 ${f1(Y(best))} H${f1(last[0] - 12)}`}
            stroke={c.muted}
            strokeWidth={1.2}
            strokeDasharray="3 4"
          />
          {bestLabel ? (
            <VizText x={8} y={f1(Y(best) - 5)} color={c.muted} anchor="start">
              {bestLabel}
            </VizText>
          ) : null}
        </G>
      ) : null}
      <Path
        d={`${d} L${f1(last[0])} ${height} L6 ${height}Z`}
        fill={color}
        opacity={0.1}
      />
      <Path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={2.6}
        strokeLinecap="round"
      />
      {points.slice(1, -1).map(([x, y], i) => (
        <Path
          key={i}
          d={ribLeaf(x, y, 9, i % 2 ? -0.9 : -2.25, 0.42, false)}
          fill={color}
          stroke={color}
          strokeWidth={0.8}
          opacity={0.85}
        />
      ))}
      <Circle cx={f1(last[0])} cy={f1(last[1])} r={4.5} fill={c.mark} />
      <Path
        d={ribLeaf(last[0], last[1] - 4, 12, -1.15, 0.42, false)}
        fill={c.mark}
        stroke={c.mark}
        strokeWidth={0.8}
      />
    </Viz>
  )
}

/** Progress on one hand-drawn line (ADR-0032): ``value`` 0–1 of the dotted
 * track drawn, ``mark`` a tick where the target sits. */
export function Meter({
  value,
  color,
  mark,
}: {
  value: number
  color: string
  mark?: number
}) {
  const { q, c } = useCard(),
    p = P * q,
    v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <View style={{ height: 6 * p, justifyContent: "center" }}>
      <LineTrack value={v} color={color} height={5 * p} track={c.muted} />
      {mark !== undefined && mark > 0 && mark < 1 ? (
        <View
          style={{
            position: "absolute",
            left: `${mark * 100}%`,
            top: -4 * p,
            bottom: -4 * p,
            width: 2 * p,
            marginLeft: -p,
            borderRadius: p,
            backgroundColor: c.ink,
          }}
        />
      ) : null}
    </View>
  )
}
/** Progress rows: a name, its value, and its line under them. */
export function Meters({
  rows,
}: {
  rows: {
    name: string
    value: number
    label: string
    color: string
    mark?: number
    bad?: boolean
  }[]
}) {
  const { q, c } = useCard(),
    p = P * q
  return (
    <View style={{ gap: 9 * p }}>
      {rows.map((r) => (
        <View key={r.name} style={{ gap: 4 * p }}>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 8 * p,
            }}
          >
            <View style={{ flexShrink: 1 }}>
              <Words size={14 * P} lines={1}>
                {r.name}
              </Words>
            </View>
            <View style={{ flexShrink: 1, maxWidth: "70%" }}>
              <Num
                size={14 * P}
                align="right"
                color={r.bad ? c.bad : undefined}
              >
                {r.label}
              </Num>
            </View>
          </View>
          <Meter value={r.value} color={r.color} mark={r.mark} />
        </View>
      ))}
    </View>
  )
}

/** A ranked breakdown: one row per item, a stem whose length is its value.
 * ``sets`` splits the stem into one segment per set, each ending in a leaf,
 * so the leaves count the sets. Rows past the room go into "+N more". */
export function XBars({
  rows,
  color,
  more = 0,
}: {
  rows: {
    key: string
    name: string
    value: number
    label: string
    sets?: number
    pr?: boolean
  }[]
  color: string
  /** Rows already left out by the caller, counted into "+N more". */
  more?: number
}) {
  const { q, c, floor } = useCard(),
    p = P * q,
    shown = useRows(rows.length),
    max = Math.max(1, ...rows.map((r) => r.value)),
    left = rows.length - shown + more
  return (
    <View style={{ gap: 6 * p }}>
      {rows.slice(0, shown).map((r, i) => {
        const w = Math.max(16, (r.value / max) * 300),
          random = rng(i * 7 + 3)
        let stem = "",
          leaves = ""
        if (r.sets && r.sets > 0) {
          const gap = 3,
            n = Math.min(r.sets, 12),
            seg = (w - 6 - gap * (n - 1)) / n
          for (let k = 0; k < n; k++) {
            const x0 = 6 + k * (seg + gap),
              x1 = x0 + seg
            stem += `${smooth(
              jitter(
                [
                  [x0, 9],
                  [x0 + seg * 0.5, 8.6 + (k % 2) * 0.8],
                  [x1, 9],
                ],
                0.8,
                random,
              ),
            )} `
            leaves += `${ribLeaf(x1, 8, 7.5, k % 2 ? -0.95 : -2.2, 0.42, false)} `
          }
        } else
          stem = smooth(
            jitter(
              [
                [6, 9],
                [6 + (w - 6) * 0.33, 8.4],
                [6 + (w - 6) * 0.66, 9.6],
                [w, 9],
              ],
              1.1,
              random,
            ),
          )
        return (
          <View key={r.key} testID="card-row">
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12 * p,
              }}
            >
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4 * p,
                }}
              >
                <View style={{ flexShrink: 1 }}>
                  <Words size={14 * P} lines={1}>
                    {r.name}
                  </Words>
                </View>
                {r.pr ? <Sprig size={16 * p} /> : null}
              </View>
              <View style={{ flexShrink: 0, maxWidth: "55%" }}>
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}
                  allowFontScaling={false}
                  style={{
                    fontFamily: fonts.medium,
                    fontSize: Math.max(14 * P, floor ?? 0) * q,
                    lineHeight: Math.max(14 * P, floor ?? 0) * q * 1.36,
                    color: c.ink,
                    textAlign: "right",
                    fontVariant: ["tabular-nums"],
                    ...shadowOf(c, 14 * p),
                  }}
                >
                  {r.sets ? (
                    <Text style={{ fontFamily: fonts.body, color: c.muted }}>
                      {`${fmt(r.sets)} ${r.sets === 1 ? "set" : "sets"} · `}
                    </Text>
                  ) : null}
                  {r.label}
                </Text>
              </View>
            </View>
            <Svg width={312 * p} height={13 * p} viewBox="0 0 312 13">
              <Path
                d="M6 9 H306"
                stroke={c.track}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeDasharray="1 5"
              />
              <Path
                d={stem}
                fill="none"
                stroke={color}
                strokeWidth={4}
                strokeLinecap="round"
              />
              {leaves ? (
                <Path
                  d={leaves}
                  fill={c.mark}
                  stroke={c.mark}
                  strokeWidth={0.8}
                  strokeLinejoin="round"
                />
              ) : null}
            </Svg>
          </View>
        )
      })}
      {left > 0 && <Label>{`+${fmt(left)} more`}</Label>}
    </View>
  )
}

/** A path from 0 to the next milestone: a leaf on each one passed, an open
 * bud on the ones ahead. */
export function Growth({
  stops,
  now,
  end,
  unit,
  height,
  color,
}: {
  stops: number[]
  now: number
  end: number
  unit: string
  height: number
  color: string
}) {
  const { c } = useCard(),
    X = (v: number) => 8 + (Math.min(v, end) / Math.max(1, end)) * 286,
    y = height - 30,
    done = smooth(
      jitter(
        Array.from(
          { length: 9 },
          (_, i): Point => [X((now * i) / 8), y + Math.sin(i * 1.3) * 3],
        ),
        1.5,
        rng(31),
      ),
    )
  return (
    <Viz h={height} label="Progress to the next milestone">
      <Path
        d={`M${f1(X(now))} ${y} H${f1(X(end))}`}
        stroke={c.muted}
        strokeWidth={1.5}
        strokeDasharray="2 5"
        strokeLinecap="round"
      />
      {now > 0 ? (
        <Path
          d={done}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
        />
      ) : null}
      {stops.map((v) => {
        const x = X(v),
          passed = v <= now
        return (
          <G key={v}>
            {passed ? (
              <Path
                d={ribLeaf(x, y - 3, 22, -1.35, 0.44, true)}
                fill={c.mark}
                stroke={c.mark}
                strokeWidth={0.8}
              />
            ) : (
              <Path
                d={ribLeaf(x, y - 3, 22, -1.57, 0.44, false)}
                fill="none"
                stroke={c.muted}
                strokeWidth={1.4}
              />
            )}
            <VizText
              x={f1(v === end ? 312 : x)}
              y={height - 4}
              color={v === now ? c.ink : c.muted}
              anchor={v === end ? "end" : "middle"}
            >
              {`${fmt(v)}${v === end ? ` ${unit}` : ""}`}
            </VizText>
          </G>
        )
      })}
    </Viz>
  )
}

/** A gradient ground behind everything on the card, drawn in SVG so it
 * renders alike on every platform and is captured at full resolution. */
function CardGround({ width, height }: { width: number; height: number }) {
  const { c } = useCard(),
    id = `ground-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  if (!c.gradient) return null
  const stops = c.gradient.stops
  // The SVG sits in an unpadded box pinned to the card's edges. Given
  // `100%` itself while absolute in the padded card, Yoga measured it
  // against the content box, and the gradient stopped a padding short of
  // the right and bottom edges, in the preview and the exported image.
  // Its size is given in points, not `100%`: react-native-svg does not
  // measure a percentage again when the card changes shape, so a card
  // switched from Story to 4:5 or Square kept the old gradient and showed
  // its dark base as a band.
  return (
    <View
      testID="card-ground"
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Svg width={width} height={height} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {stops.map((color, i) => (
              <Stop
                key={`${color}-${i}`}
                offset={stops.length > 1 ? i / (stops.length - 1) : 0}
                stopColor={color}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/** The hand-drawn motif behind the content, at about a fifth of its
 * strength: a frond, a vine or a sprig by area, kept to the card's edges. */
function Deco({
  kind,
  width,
  height,
}: {
  kind: DecoKind
  width: number
  height: number
}) {
  const { c } = useCard(),
    h = decoHeight(height / width),
    d = useMemo(() => decoPath(kind, h, 2), [kind, h])
  return (
    <View
      testID="card-deco"
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 360 ${h}`}
        preserveAspectRatio="xMidYMid slice"
        opacity={c.dark ? 0.2 : 0.22}
      >
        <Path
          d={d}
          fill="none"
          stroke={c.mark}
          strokeWidth={1.3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={d}
          fill="none"
          stroke={c.mark}
          strokeWidth={0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
          transform="translate(0.9 -0.7) rotate(0.6)"
        />
      </Svg>
    </View>
  )
}
/** The motif each area is drawn with: fronds for training, vines for habits,
 * tasks and the journal, sprigs for recaps, money and food. */
const decoFor = (accent?: Accent): DecoKind =>
  accent === "fit"
    ? "frond"
    : accent === "hab" || accent === "tsk"
      ? "vine"
      : "sprig"

/** The flat Unfurl mark (docs/brand Logos): the fiddlehead as one stroke. */
const MARK = [
  "M7.5 21.5 C7.5 16.5 8.6 12.6 11.6 10.1 C14.2 7.9 18.7 8.4 18.9 12.1 C19.1 15 16 16.4 14 14.9 C12.5 13.8 12.9 11.4 14.8 11.2 C16.1 11.1 16.9 12.3 16.2 13.2",
  "M8 18 C6.3 17 4.6 17.2 3.6 18.5",
  "M8.9 14.4 C7.5 13.2 5.8 13 4.7 13.9",
]
/** The flat lockup: the mark plus "unfurl" in Geist Medium, −3%. Never
 * Fern: Fern is the chat character, not the card's signature. */
export function Lockup({ size }: { size: number }) {
  const { q, c } = useCard()
  return (
    <View
      testID="card-lockup"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 0.4 * size * q,
      }}
    >
      <Svg width={size * 1.15 * q} height={size * 1.15 * q} viewBox="0 0 24 24">
        {MARK.map((d) => (
          <Path
            key={d}
            d={d}
            fill="none"
            stroke={c.mark}
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </Svg>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{
          fontFamily: fonts.medium,
          fontSize: size * q,
          lineHeight: size * q * 1.2,
          letterSpacing: -0.03 * size * q,
          color: c.ink,
          ...shadowOf(c, size * q),
        }}
      >
        unfurl
      </Text>
    </View>
  )
}

/** On a photo the data is drawn at this share of its usual size, so it
 * sits as a compact block and the picture keeps most of the card. */
export const COMPACT = 0.7
/** How much of the card's height the photo keeps clear, against the data
 * block's 1: a story leaves the top half to the picture, a square less. */
const ROOM: Record<CardFormat, number> = {
  "9:16": 0.35,
  "4:5": 0.3,
  "1:1": 0.2,
}

/** The person's photo, full bleed, under two soft scrims (darker at the
 * foot where the data sits, faint at the top) instead of a box: the words
 * also carry a shadow, so they hold on a bright photo. */
function PhotoGround({
  uri,
  width,
  height,
}: {
  uri: string
  width: number
  height: number
}) {
  const id = `scrim-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`,
    shade = palette.dark.background
  return (
    <View
      testID="card-photo"
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <Image
        source={{ uri }}
        resizeMode="cover"
        accessibilityIgnoresInvertColors
        style={{ position: "absolute", top: 0, left: 0, width, height }}
      />
      <Svg
        width={width}
        height={height}
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={shade} stopOpacity={0.32} />
            <Stop offset={0.16} stopColor={shade} stopOpacity={0} />
            <Stop offset={0.4} stopColor={shade} stopOpacity={0} />
            <Stop offset={0.7} stopColor={shade} stopOpacity={0.5} />
            <Stop offset={1} stopColor={shade} stopOpacity={0.82} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/** A short hand-drawn strand above the data on a photo: the nature line in
 * its smallest form, where the full motif would fight the picture. */
function Strand({ kind }: { kind: DecoKind }) {
  const { q, c } = useCard(),
    p = P * q,
    d = useMemo(() => {
      const random = rng(kind.length * 13 + 5),
        pts: Point[] = Array.from({ length: 8 }, (_, i) => [
          2 + i * 9,
          9 + Math.sin(i * 0.9) * 3,
        ])
      return smooth(jitter(pts, 1.2, random))
    }, [kind])
  return (
    <View testID="card-strand">
      <Svg width={84 * p} height={18 * p} viewBox="0 0 84 18">
        <Path
          d={d}
          fill="none"
          stroke={c.mark}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={ribLeaf(66, 9, 12, -0.6)}
          fill="none"
          stroke={c.mark}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  )
}

export function CardFrame({
  width,
  look,
  children,
  date,
  foot,
  mark = true,
  accent,
  deco,
}: {
  mark?: boolean
  /** The card's window ("Sat 1 Nov", "1–31 Oct"): the only thing at the top. */
  date?: string
  foot?: ReactNode
  width: number
  look: CardLook
  /** The area the card is about: picks the background motif. */
  accent?: Accent
  deco?: DecoKind
  children: ReactNode
}) {
  const q = width / 100,
    p = P * q,
    c = cardInk(look),
    f = look.format,
    tall = f === "9:16",
    height = width * ratioOf(f),
    shot = useContext(CardShotContext),
    onPhoto = look.backdrop === "photo"
  const [fit, setFit] = useState<Fit>({ stage: 0, rows: 0 }),
    parts = useRef<FitParts>(new Map()),
    size = useRef({ box: -1, inner: -1 }),
    [tick, setTick] = useState(0)
  const ctx = useMemo(
    () => ({
      fit,
      part: (kind: Drop | "rows", n: number) => {
        parts.current.set(kind, (parts.current.get(kind) ?? 0) + n)
        return () => {
          parts.current.set(kind, (parts.current.get(kind) ?? 0) - n)
        }
      },
      measure: (which: "box" | "inner", h: number) => {
        if (size.current[which] === h) return
        size.current[which] = h
        setTick((t) => t + 1)
      },
    }),
    [fit],
  )
  // A new shape, size or background starts the rule again from the full
  // card. A step is never taken back, so without this a photo's compact
  // fit would stay on the card after switching to a plain ground, and the
  // shared image would miss rows there is room for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on a new shape only
  useEffect(() => {
    setFit({ stage: 0, rows: 0 })
  }, [width, f, look.backdrop])
  // One step per settled layout: a first pass (fonts still loading, a
  // number not yet shrunk to its line) can read taller than the card ends
  // up, and a step is never taken back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each measurement
  useEffect(() => {
    const timer = setTimeout(() => {
      const { box, inner } = size.current
      if (box < 0 || inner < 0 || inner <= box + 0.5) return
      setFit((cur) => nextFit(cur, parts.current))
    }, FIT_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [tick])
  return (
    <CardContext.Provider value={{ q, c, f }}>
      <FitContext.Provider value={ctx}>
        {/* The rounded corners and hairline are on-screen chrome only. The
            exported image is the square-cornered card inside, so a shared
            PNG has no transparent corners for Instagram to fill with
            notches. */}
        <View
          style={{
            width,
            aspectRatio: 1 / ratioOf(f),
            borderRadius: 5 * q,
            overflow: "hidden",
          }}
        >
          <View
            ref={shot}
            collapsable={false}
            testID="card-shot"
            style={{
              flex: 1,
              paddingHorizontal: 24 * p,
              // A story keeps clear of the app's own top and bottom bars.
              paddingTop: (tall ? 88 : 24) * p,
              paddingBottom: (tall ? 120 : 24) * p,
              gap: 12 * p,
              overflow: "hidden",
              backgroundColor: c.bg,
            }}
          >
            <CardGround width={width} height={height} />
            {onPhoto && look.photo && (
              <PhotoGround uri={look.photo} width={width} height={height} />
            )}
            {!onPhoto && look.backdrop !== "sticker" && (
              <Deco
                kind={deco ?? decoFor(accent)}
                width={width}
                height={height}
              />
            )}
            {onPhoto ? (
              <>
                {/* The photo's room: nothing is drawn over it. */}
                <View testID="card-photo-room" style={{ flex: ROOM[f] }} />
                <CardContext.Provider
                  value={{ q: q * COMPACT, c, f, floor: 11 * (P / COMPACT) }}
                >
                  <View
                    testID="card-overlay"
                    style={{
                      flex: 1,
                      minHeight: 0,
                      justifyContent: "flex-end",
                      gap: 10 * p * COMPACT,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8 * p * COMPACT,
                      }}
                    >
                      <Strand kind={deco ?? decoFor(accent)} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        {!!date && (
                          <Words
                            size={13 * P}
                            weight="medium"
                            lines={1}
                            align="right"
                            muted
                          >
                            {date}
                          </Words>
                        )}
                      </View>
                    </View>
                    {children}
                  </View>
                </CardContext.Provider>
              </>
            ) : (
              <>
                {!!date && (
                  <Words
                    size={13 * P}
                    weight="medium"
                    lines={1}
                    align="right"
                    muted
                  >
                    {date}
                  </Words>
                )}
                {children}
              </>
            )}
            {(mark || !!foot) && (
              <View
                style={{
                  marginTop: onPhoto ? 0 : "auto",
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8 * p,
                }}
              >
                {mark ? <Lockup size={14 * P} /> : <View />}
                <View style={{ flex: 1, minWidth: 0 }}>
                  {typeof foot === "string" ? (
                    <Words size={13 * P} lines={2} align="right" muted>
                      {foot}
                    </Words>
                  ) : (
                    foot
                  )}
                </View>
              </View>
            )}
          </View>
          {look.backdrop !== "sticker" && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 5 * q,
                borderWidth: 1,
                borderColor: c.line,
              }}
            />
          )}
        </View>
      </FitContext.Provider>
    </CardContext.Provider>
  )
}

/** The PNG is 1080 pixels wide. iOS view-shot takes the size in points and
 * draws at the screen's scale, so 1080 there would come out 2160 or 3240
 * wide; Android takes pixels. Either way it equals the laid-out size of the
 * hidden export copy, so nothing is resampled. */
function exportSize(format: CardFormat) {
  const scale = Platform.OS === "ios" ? PixelRatio.get() : 1
  return {
    width: 1080 / scale,
    height: Math.round(1080 * ratioOf(format)) / scale,
  }
}

/** A fixed preview of a card (privacy check, tests): no composer chrome. */
export function CardPreview({ children }: { children: ReactNode }) {
  return <View collapsable={false}>{children}</View>
}

export function ShareComposer<K extends string>({
  value,
  onChange,
  items,
  caption,
  children,
  formats = ["9:16", "4:5", "1:1"],
  beforeShare,
  onLookChange,
  shareRef,
  postFormats,
}: {
  value: K
  onChange: (key: K) => void
  items: {
    key: K
    label: string
    render: (width: number, look: CardLook) => ReactNode
  }[]
  /** Kept for call sites; the composer chrome uses theme tokens only. */
  accent?: Accent
  caption: string
  children: ReactNode
  formats?: CardFormat[]
  beforeShare?: (proceed: () => Promise<void>) => void
  onLookChange?: (look: CardLook) => void
  shareRef?: { current: (() => Promise<void>) | null }
  /** Sizes a card can be laid out in for a post, when they differ from
   * ``formats`` (a story-only card that has a 4:5 layout). */
  postFormats?: CardFormat[]
}) {
  const t = useTheme(),
    social = useShown("social")
  const [format, setFormat] = useState<CardFormat>("9:16"),
    [backdrop, setBackdrop] = useState<CardBackdrop>("fern"),
    [photo, setPhoto] = useState<string | null>(null),
    [color, setColor] = useState<string>(palette.light.primary),
    // The caption that goes with a post and is copied for other apps:
    // the card's own until the person edits it.
    [edited, setEdited] = useState<string | null>(null),
    [captionOpen, setCaptionOpen] = useState(false),
    // Mounted from the first open on, so it can animate out after that.
    [captionUsed, setCaptionUsed] = useState(false),
    [copied, setCopied] = useState(false)
  const text = edited ?? caption
  const screen = useWindowDimensions().width,
    windowWidth = Math.min(screen, 480),
    inset = (windowWidth - 32) * 0.18,
    width = Math.min(
      (windowWidth - 2 * inset) *
        (format === "9:16" ? 0.64 : format === "4:5" ? 0.76 : 0.8),
      format === "9:16" ? 300 : format === "4:5" ? 340 : 360,
    ),
    // Side padding that centres every card, the last one included: with
    // less, the scroll stops short and the last card could not be chosen.
    padding = (screen - width) / 2
  const look = { format, backdrop, photo, color },
    refs = useRef<Record<string, HostInstance | null>>({}),
    shots = useRef<Record<string, HostInstance | null>>({}),
    target = (key: string) => shots.current[key] ?? refs.current[key],
    // The selected card laid out at exactly 1080 px wide, off screen: the
    // export is captured from it rather than scaled up from the preview.
    exportShot = useRef<HostInstance | null>(null),
    exportWidth = 1080 / PixelRatio.get(),
    exportNode = () => exportShot.current ?? target(value),
    // A post frame is 4:5 at most, so a story-sized card posted as it is
    // would lose its top and bottom to the crop: the post is laid out at
    // 4:5 instead, in a second hidden copy, when the card has that size.
    postFormat: CardFormat =
      format === "9:16" && (postFormats ?? formats).includes("4:5")
        ? "4:5"
        : format,
    postShot = useRef<HostInstance | null>(null),
    scroll = useRef<ScrollViewInstance>(null)
  useEffect(() => {
    if (!formats.includes(format)) setFormat(formats[0])
  }, [formats, format])
  const index = items.findIndex((i) => i.key === value)
  useEffect(() => {
    scroll.current?.scrollTo({
      x: Math.max(0, index * (width + 12)),
      animated: false,
    })
  }, [index, width])
  const doShare = async () => {
    try {
      const node = exportNode()
      if (Platform.OS !== "web" && node) {
        const uri = await captureRef(node, {
          format: "png",
          quality: 1,
          ...exportSize(format),
        })
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "image/png" })
          logUsage({ kind: "share_card", detail: value })
          return
        }
      }
      await Share.share({ message: text })
      logUsage({ kind: "share_card", detail: value })
    } catch {
      toast.error("Could not share this image. You can still copy its caption.")
    }
  }
  // Render the selected card to a PNG for the in-app feed/story.
  const capture = async (shape: CardFormat = format) => {
    const node =
      shape !== format ? (postShot.current ?? exportNode()) : exportNode()
    if (!node) return null
    try {
      if (Platform.OS === "web")
        return await captureRef(target(value) ?? node, {
          format: "png",
          result: "data-uri",
        })
      const uri = await captureRef(node, {
        format: "png",
        quality: 1,
        ...exportSize(node === postShot.current ? shape : format),
      })
      return await keep(uri, "png")
    } catch {
      return null
    }
  }
  /** The card as a community photo: the PNG itself as the full image (no
   * re-encoding of its gradients) plus a preview and a placeholder. A card
   * that cannot be prepared is posted as it is. */
  const asMedia = async (
    uri: string,
    shape: CardFormat = format,
  ): Promise<Media> => {
    const ratio = 1 / ratioOf(shape)
    try {
      const p = await prepareImage(uri, { keepPng: true })
      return {
        kind: "image",
        uri: p.full,
        mime: p.fullMime,
        previewUri: p.preview,
        lqip: p.lqip,
        width: p.width,
        height: p.height,
        ratio,
      }
    } catch {
      return { kind: "image", uri, ratio }
    }
  }
  /** The card in a post frame (1:1 cards stay square, the rest go 4:5),
   * opened in the frame editor so it can be placed before posting. */
  const toFeed = async () => {
    const shape = postShot.current ? postFormat : format
    const uri = await capture(shape)
    let media: Media | undefined
    if (uri)
      try {
        media = await framePhoto(
          { uri },
          frameRatio(1 / ratioOf(shape)),
          CENTRED,
          { png: true },
        )
      } catch {
        media = await asMedia(uri, shape)
      }
    setPostDraft({ caption: text, media: media ? [media] : [] })
    go(
      !media
        ? "/social/compose?progress=1"
        : media.edit
          ? "/social/compose?adjust=1"
          : "/social/compose",
    )
  }
  const toStory = async () => {
    const uri = await capture()
    if (!uri) {
      toast.error("Couldn't render this card. Try Post instead.")
      return
    }
    const m = await asMedia(uri)
    // The story ring shows it landed.
    addStory({
      kind: "image",
      uri: m.uri,
      previewUri: m.previewUri,
      lqip: m.lqip,
      ratio: m.ratio,
    })
  }
  if (shareRef) shareRef.current = doShare
  useEffect(() => {
    onLookChange?.({ format, backdrop, photo, color })
  }, [format, backdrop, photo, color, onLookChange])
  const share = () => (beforeShare ? beforeShare(doShare) : doShare())
  const swatch = (key: CardBackdrop): string | string[] =>
    GRADIENTS[key] ??
    (key === "dark"
      ? palette.dark.background
      : key === "light"
        ? palette.light.background
        : key === "custom"
          ? color
          : t.soft)
  const selected = items.find((i) => i.key === value)
  return (
    <View style={{ gap: 12, paddingTop: 4 }}>
      <View>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={width + 12}
          decelerationRate="fast"
          style={{ marginHorizontal: -16 }}
          contentContainerStyle={{
            paddingHorizontal: padding,
            paddingVertical: 8,
            gap: 12,
          }}
          onMomentumScrollEnd={(e) => {
            const i = Math.max(
              0,
              Math.min(
                items.length - 1,
                Math.round(e.nativeEvent.contentOffset.x / (width + 12)),
              ),
            )
            onChange(items[i].key)
          }}
        >
          {items.map((item) => (
            <Tap
              key={item.key}
              label={item.label}
              onPress={() => {
                onChange(item.key)
                scroll.current?.scrollTo({
                  x: items.indexOf(item) * (width + 12),
                  animated: true,
                })
              }}
              style={{
                opacity: item.key === value ? 1 : 0.45,
                transform: [{ scale: item.key === value ? 1 : 0.94 }],
              }}
            >
              <View
                ref={(v) => {
                  refs.current[item.key] = v
                }}
                collapsable={false}
              >
                <CardShotContext.Provider
                  value={(v) => {
                    shots.current[item.key] = v
                  }}
                >
                  {item.render(width, look)}
                </CardShotContext.Provider>
              </View>
            </Tap>
          ))}
        </ScrollView>
        {selected && (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 0,
              height: 0,
              overflow: "hidden",
            }}
          >
            {/* Keyed by card: each card's copy mounts fresh, so it fits
                from the full card instead of inheriting what the previous
                card had to drop. */}
            <View
              key={`export-${value}`}
              testID="card-export"
              collapsable={false}
              style={{ width: exportWidth }}
            >
              <CardShotContext.Provider
                value={(v) => {
                  exportShot.current = v
                }}
              >
                {selected.render(exportWidth, look)}
              </CardShotContext.Provider>
            </View>
            {social && postFormat !== format && (
              <View
                key={`post-${value}`}
                testID="card-post"
                collapsable={false}
                style={{ width: exportWidth }}
              >
                <CardShotContext.Provider
                  value={(v) => {
                    postShot.current = v
                  }}
                >
                  {selected.render(exportWidth, {
                    ...look,
                    format: postFormat,
                  })}
                </CardShotContext.Provider>
              </View>
            )}
          </View>
        )}
        <Line style={{ justifyContent: "center", gap: 8, marginTop: 8 }}>
          <Copy size={14} weight="semibold">
            {items.find((x) => x.key === value)?.label}
          </Copy>
          <Line style={{ gap: 4 }}>
            {items.map((item) => (
              <View
                key={item.key}
                style={{
                  width: item.key === value ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: item.key === value ? t.text : t.line,
                }}
              />
            ))}
          </Line>
        </Line>
      </View>
      <Line style={{ paddingTop: 8, justifyContent: "space-around" }}>
        {[
          ...(social
            ? [
                { label: "Post", Icon: ImagePlus, action: toFeed },
                { label: "Story", Icon: PlusCircle, action: toStory },
              ]
            : []),
          { label: "Save", Icon: Download, action: share },
          {
            label: "Caption",
            Icon: CopyIcon,
            action: () => {
              setCopied(false)
              setCaptionUsed(true)
              setCaptionOpen(true)
            },
          },
          { label: "More", Icon: Ellipsis, action: share },
        ].map(({ label, Icon, action }) => (
          <Tap
            key={label}
            label={label}
            onPress={() => void action()}
            style={{ flex: 1, alignItems: "center", gap: 6 }}
          >
            <View
              style={{
                width: 48,
                height: 48,
                borderRadius: 24,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={20} color={t.text} strokeWidth={1.75} />
            </View>
            <Copy size={12}>{label}</Copy>
          </Tap>
        ))}
      </Line>
      <Copy
        size={13}
        muted
        style={{ marginTop: 12, marginBottom: -4, paddingHorizontal: 4 }}
      >
        Size
      </Copy>
      <Segmented
        value={format}
        onChange={setFormat}
        options={formats.map((value) => ({
          value,
          label: { "9:16": "Story", "4:5": "Post 4:5", "1:1": "Square" }[value],
        }))}
      />
      <Copy
        size={13}
        muted
        style={{ marginTop: 12, marginBottom: -4, paddingHorizontal: 4 }}
      >
        Background
      </Copy>
      {/* Wider than a phone: it scrolls, with the screen's inset at both
          ends so the last option can be reached whole. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        testID="backdrop-row"
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 4 }}
      >
        {BACKDROPS.map((b) => (
          <Tap
            key={b.key}
            label={`${b.label} background`}
            onPress={() => {
              setBackdrop(b.key)
              // Picking Photo with none chosen yet opens the library.
              if (b.key === "photo" && !photo)
                void pickPhoto().then((v) => v && setPhoto(v))
            }}
            style={{ alignItems: "center", gap: 6, width: 56 }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: [swatch(b.key)].flat()[0],
                overflow: "hidden",
                // Selected: a 2 pt ink outline, never colour alone.
                borderWidth: backdrop === b.key ? 2 : 1,
                borderStyle:
                  b.key === "sticker" && backdrop !== b.key
                    ? "dashed"
                    : "solid",
                borderColor: backdrop === b.key ? t.text : t.input,
              }}
            >
              {Array.isArray(swatch(b.key)) && (
                <Swatch stops={[swatch(b.key)].flat()} />
              )}
              {b.key === "photo" &&
                (photo ? (
                  <Image
                    source={{ uri: photo }}
                    style={{ position: "absolute", width: 44, height: 44 }}
                  />
                ) : (
                  <ImageIcon size={18} color={t.text} strokeWidth={1.75} />
                ))}
              {b.key === "custom" && (
                <Palette
                  size={18}
                  color={luminance(color) > 0.4 ? t.text : t.bg}
                  strokeWidth={1.75}
                />
              )}
              {b.key === "sticker" && (
                <Sticker size={18} color={t.text} strokeWidth={1.75} />
              )}
            </View>
            <Copy size={12}>{b.label}</Copy>
          </Tap>
        ))}
      </ScrollView>
      {backdrop === "photo" && (
        <Tap
          label={photo ? "Change photo" : "Choose a photo"}
          onPress={() => void pickPhoto().then((v) => v && setPhoto(v))}
          style={{
            minHeight: 64,
            borderRadius: 16,
            borderWidth: 1,
            borderStyle: photo ? "solid" : "dashed",
            borderColor: photo ? t.line : t.input,
            backgroundColor: t.card,
            padding: 10,
          }}
        >
          <Line style={{ gap: 12 }}>
            {photo ? (
              <Image
                source={{ uri: photo }}
                style={{ width: 44, height: 44, borderRadius: 10 }}
              />
            ) : (
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ImagePlus size={22} color={t.text} strokeWidth={1.75} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="semibold">
                {photo ? "Change photo" : "Choose a photo"}
              </Copy>
              <Copy size={12} muted>
                {photo
                  ? "Your photo fills the card. The numbers sit small at the bottom."
                  : "From your library or camera. It fills the card, with the numbers small at the bottom."}
              </Copy>
            </View>
            {Platform.OS !== "web" && (
              <Tap
                label="Take a photo"
                onPress={() =>
                  void pickPhoto(true).then((v) => v && setPhoto(v))
                }
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: t.soft,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Camera size={20} color={t.text} strokeWidth={1.75} />
              </Tap>
            )}
            {photo && (
              <Tap label="Remove photo" onPress={() => setPhoto(null)}>
                <Copy size={13} style={{ color: t.bad }}>
                  Remove
                </Copy>
              </Tap>
            )}
          </Line>
        </Tap>
      )}
      {backdrop === "custom" && (
        <ColorPicker value={color} onChange={setColor} />
      )}
      {backdrop === "sticker" && (
        <Line
          style={{
            gap: 10,
            alignItems: "flex-start",
            padding: 12,
            borderRadius: 14,
            backgroundColor: t.soft,
          }}
        >
          <Sticker size={18} color={t.text} strokeWidth={1.75} />
          <Copy size={13} muted style={{ flex: 1 }}>
            A see-through card to paste on top of your own photo or story. Save
            it, then add it as a sticker in Instagram or any app that takes
            images.
          </Copy>
        </Line>
      )}
      {children}
      {captionUsed && (
        <Sheet
          title="Caption"
          open={captionOpen}
          onClose={() => setCaptionOpen(false)}
        >
          <Field
            label="Caption"
            hideLabel
            testID="caption-input"
            value={text}
            onChangeText={(v) => {
              setEdited(v.slice(0, 2200))
              setCopied(false)
            }}
            placeholder="Write a caption…"
            multiline
            numberOfLines={4}
          />
          <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
            Goes with your post. Copy it to paste under the image in another
            app.
          </Copy>
          <Line style={{ gap: 8, marginTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                icon={copied ? Check : CopyIcon}
                onPress={() => void copyText(text).then(setCopied)}
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button icon={Check} onPress={() => setCaptionOpen(false)}>
                Done
              </Button>
            </View>
          </Line>
        </Sheet>
      )}
    </View>
  )
}

/** A composer swatch for a gradient ground: a small round preview. */
function Swatch({ stops }: { stops: string[] }) {
  const id = `swatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <Svg width={44} height={44} style={{ position: "absolute", inset: 0 }}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          {stops.map((color, i) => (
            <Stop
              key={`${color}-${i}`}
              offset={i / Math.max(1, stops.length - 1)}
              stopColor={color}
            />
          ))}
        </LinearGradient>
      </Defs>
      <Circle cx={22} cy={22} r={22} fill={`url(#${id})`} />
    </Svg>
  )
}

/** A long list on a card (every set of a workout): it takes the room left
 * and draws its content at the largest scale that fits, down to ``min``,
 * instead of dropping rows. ``children`` gets the scale it is drawn at and
 * whether one column overflowed at ``min``: then it goes to two columns,
 * fitted again from full size. */
export function Dense(props: {
  children: (state: { scale: number; over: boolean }) => ReactNode
  min?: number
}) {
  const { f, q } = useCard()
  // A new shape or size fits again from scratch: on the web a resized box
  // does not always report its new layout, a freshly mounted one does.
  return <DenseFit key={`${f}:${Math.round(q * 100)}`} {...props} />
}
function DenseFit({
  children,
  min = 0.6,
}: {
  children: (state: { scale: number; over: boolean }) => ReactNode
  min?: number
}) {
  const card = useCard(),
    [room, setRoom] = useState(0),
    // The content's height, and the layout it was measured at.
    [inner, setInner] = useState({ h: 0, scale: 1, over: false }),
    [scale, setScale] = useState(1),
    [over, setOver] = useState(false),
    steps = useRef(0),
    lastRoom = useRef(0),
    // What is drawn now, for the layout callback: a callback the platform
    // kept from an earlier render would otherwise tag the measurement with
    // an old scale, and it would never count.
    drawn = useRef({ scale, over })
  drawn.current = { scale, over }
  useEffect(() => {
    if (room <= 0) return
    // A new room starts again from full size, in one column.
    if (room !== lastRoom.current) {
      lastRoom.current = room
      steps.current = 0
      if (scale !== 1 || over) {
        setScale(1)
        setOver(false)
        return
      }
    }
    // Only a measurement of the layout now drawn counts.
    if (inner.scale !== scale || inner.over !== over) return
    if (inner.h <= room + 0.5 || steps.current > 8) return
    steps.current++
    // At the floor in one column: two columns, from full size.
    if (scale > min + 0.001)
      setScale(Math.max(min, scale * (room / inner.h) * 0.97))
    else if (!over) {
      setOver(true)
      setScale(1)
    }
  }, [room, inner, scale, over, min])
  return (
    <View
      testID="card-dense"
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      onLayout={(e) => {
        const h = Math.round(e.nativeEvent.layout.height)
        setRoom((v) => (Math.abs(v - h) < 1 ? v : h))
      }}
    >
      <CardContext.Provider value={{ ...card, q: card.q * scale }}>
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0 }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height,
              now = drawn.current
            setInner((v) =>
              Math.abs(v.h - h) < 0.5 &&
              v.scale === now.scale &&
              v.over === now.over
                ? v
                : { h, ...now },
            )
          }}
        >
          {children({ scale, over })}
        </View>
      </CardContext.Provider>
    </View>
  )
}
/** The record sprig, for a list row that set one. */
export const CardSprig = Sprig
/** The text shadow a word needs on a photo (none elsewhere). */
export const cardShadow = shadowOf
