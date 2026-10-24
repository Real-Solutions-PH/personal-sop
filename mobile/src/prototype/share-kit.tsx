import type { HostInstance, ScrollViewInstance } from "react-native"
// Share cards (ADR-0019): one family of flat cards on a paper or ink ground,
// the flat Unfurl lockup, Geist for words and Geist Mono for numbers. No
// gradients: those belong to Fern's orb alone. Every size is a fraction of
// the card's width (`q` = 1% of it), so a card reads the same at 180 pt in
// the privacy check and at 1080 px in the exported PNG.

import { palette } from "@domain/design/tokens"
import * as Sharing from "expo-sharing"
import {
  Copy as CopyIcon,
  Download,
  Ellipsis,
  Image as ImageIcon,
  ImagePlus,
  type LucideIcon,
  Palette,
  PlusCircle,
  Sticker,
  TrendingDown,
  TrendingUp,
} from "lucide-react-native"
import {
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
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
  type ViewStyle,
} from "react-native"
import Svg, { Circle, Polygon, Polyline } from "react-native-svg"
import { captureRef } from "react-native-view-shot"
import { toast } from "sonner-native"
import { ColorPicker, luminance } from "./color-picker"
import { FernMark } from "./companion/brand"
import { copyText, pickPhoto } from "./media"
import { Copy, Line, Segmented, Tap } from "./native-kit"
import { go } from "./navigation"
import { signed } from "./share-format"
import { keep } from "./social/media"
import { addStory, setPostDraft } from "./social/store"
import { type Accent, fonts, useTheme } from "./theme"

export type CardFormat = "9:16" | "4:5" | "1:1"
const BACKDROPS = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "custom", label: "Colour" },
  { key: "photo", label: "Photo" },
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
  /** Tiles and chips sitting on the ground. */
  panel: string
  line: string
  ink: string
  muted: string
  /** Empty part of a ring, meter or dot. */
  track: string
  /** The logo mark: moss on paper, sprout on dark (docs/brand Logos). */
  mark: string
  good: string
  bad: string
  area: (a: Accent) => string
}
export function cardInk(look: CardLook): CardInk {
  const custom = look.backdrop === "custom" ? (look.color ?? null) : null
  const dark =
    look.backdrop === "light" ? false : custom ? luminance(custom) <= 0.4 : true
  const p: Tokens = palette[dark ? "dark" : "light"]
  const see = look.backdrop === "photo" || look.backdrop === "sticker"
  const tinted = !!custom || see
  return {
    dark,
    bg:
      custom ??
      (look.backdrop === "sticker" ? alpha(p.background, 0.72) : p.background),
    panel: tinted ? alpha(p.foreground, dark ? 0.1 : 0.07) : p.card,
    line: tinted ? alpha(p.foreground, 0.14) : p.border,
    ink: p.foreground,
    muted: tinted ? alpha(p.foreground, 0.78) : p["muted-foreground"],
    track: alpha(p.foreground, dark ? 0.16 : 0.1),
    mark: dark ? p.sprout : p.primary,
    good: p.good,
    bad: p.bad,
    area: (a) => p[a],
  }
}

const CardContext = createContext<{ q: number; c: CardInk }>({
  q: 1,
  c: cardInk({ format: "9:16", backdrop: "dark", photo: null }),
})
/** Where a composer wants the node it exports: the card without its
 * on-screen rounding and border. */
const CardShotContext = createContext<
  ((v: HostInstance | null) => void) | undefined
>(undefined)
/** The open card's scale and colours, for the pieces below. */
export const useCard = () => useContext(CardContext)

/** A number in Geist Mono that shrinks to fit its box rather than clip. */
export function Num({
  children,
  size,
  unit,
  color,
  align = "left",
}: {
  children: string
  size: number
  unit?: string
  color?: string
  align?: "left" | "center" | "right"
}) {
  const { q, c } = useCard()
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.3}
      allowFontScaling={false}
      style={{
        fontFamily: fonts.mono,
        fontSize: size * q,
        lineHeight: size * q * 1.18,
        letterSpacing: -0.02 * size * q,
        color: color ?? c.ink,
        textAlign: align,
        fontVariant: ["tabular-nums"],
      }}
    >
      {children}
      {unit ? (
        <Text
          style={{
            fontFamily: fonts.monoRegular,
            fontSize: Math.max(3.4, size * 0.38) * q,
            letterSpacing: 0,
            color: c.muted,
          }}
        >
          {` ${unit}`}
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
  const { q, c } = useCard()
  return (
    <Text
      numberOfLines={lines}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
      allowFontScaling={false}
      ellipsizeMode="tail"
      style={{
        fontFamily: fonts[weight],
        fontSize: size * q,
        lineHeight: size * q * (size >= 8 ? 1.1 : 1.3),
        letterSpacing: size >= 8 ? -0.02 * size * q : 0,
        color: color ?? (muted ? c.muted : c.ink),
        textAlign: align,
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
}: {
  children: ReactNode
  align?: "left" | "center" | "right"
}) {
  return (
    <Words size={3.3} weight="medium" lines={1} align={align} muted>
      {children}
    </Words>
  )
}

/** A pill with an optional icon: a verdict, a badge, a best. */
export function Chip({
  children,
  icon: Icon,
  tone,
}: {
  children: ReactNode
  icon?: LucideIcon
  tone?: string
}) {
  const { q, c } = useCard()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        maxWidth: "100%",
        gap: 1.2 * q,
        paddingHorizontal: 2.6 * q,
        paddingVertical: 1.3 * q,
        borderRadius: 10 * q,
        backgroundColor: c.panel,
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      {Icon && <Icon size={3.6 * q} color={tone ?? c.ink} strokeWidth={2} />}
      <View style={{ flexShrink: 1 }}>
        <Words size={3.3} weight="medium" lines={1}>
          {children}
        </Words>
      </View>
    </View>
  )
}

/** A change with its direction as an icon and a word, never colour alone. */
export function Delta({
  n,
  unit = "",
  suffix,
}: {
  n: number | null | undefined
  unit?: string
  suffix: string
}) {
  const { q, c } = useCard()
  if (n == null || !Number.isFinite(n) || n === 0) return null
  const Icon = n > 0 ? TrendingUp : TrendingDown,
    tone = n > 0 ? c.good : c.bad
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: q }}>
      <Icon size={3.4 * q} color={tone} strokeWidth={2} />
      <View style={{ flexShrink: 1 }}>
        <Words size={3.2} weight="medium" lines={1} color={tone}>
          {`${signed(n)}${unit} ${suffix}`}
        </Words>
      </View>
    </View>
  )
}

/** A value tile: number on top, label under it. */
export function Stat({
  value,
  unit,
  label,
  size = 9,
  children,
}: {
  value: string
  unit?: string
  label: string
  size?: number
  children?: ReactNode
}) {
  const { q, c } = useCard()
  return (
    <View
      style={{
        flex: 1,
        minWidth: 0,
        padding: 3 * q,
        gap: 0.6 * q,
        borderRadius: 3 * q,
        backgroundColor: c.panel,
        borderWidth: 1,
        borderColor: c.line,
      }}
    >
      <Num size={size} unit={unit}>
        {value}
      </Num>
      <Label>{label}</Label>
      {children}
    </View>
  )
}

/** Tiles in rows of ``cols``; the last row keeps the same tile width. */
export function Stats({
  items,
  cols = items.length,
  size,
}: {
  items: { label: string; value: string; unit?: string; delta?: ReactNode }[]
  cols?: number
  size?: number
}) {
  const { q } = useCard()
  if (!items.length) return null
  const per = Math.max(1, cols),
    rows: (typeof items)[] = []
  for (let i = 0; i < items.length; i += per) rows.push(items.slice(i, i + per))
  return (
    <View style={{ gap: 2 * q }}>
      {rows.map((row) => (
        <View
          key={row.map((x) => x.label).join("|")}
          style={{ flexDirection: "row", gap: 2 * q }}
        >
          {row.map((x) => (
            <Stat
              key={x.label}
              value={x.value}
              unit={x.unit}
              label={x.label}
              size={size}
            >
              {x.delta}
            </Stat>
          ))}
          {Array.from({ length: per - row.length }, (_, i) => (
            <View key={`gap-${i}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  )
}

/** A progress ring in one solid area colour; children sit in its hole and
 * are kept inside it. */
export function CardRing({
  value,
  size,
  color,
  children,
}: {
  value: number
  size: number
  color: string
  children?: ReactNode
}) {
  const { q, c } = useCard(),
    px = size * q,
    stroke = px * 0.08,
    r = (px - stroke) / 2,
    around = 2 * Math.PI * r,
    v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <View
      style={{
        width: px,
        height: px,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessible
      accessibilityLabel={`${Math.round(v * 100)} percent`}
    >
      <Svg width={px} height={px} style={{ position: "absolute" }}>
        <Circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          stroke={c.track}
          strokeWidth={stroke}
          fill="none"
        />
        {v > 0 && (
          <Circle
            cx={px / 2}
            cy={px / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${around * v} ${around}`}
            fill="none"
            transform={`rotate(-90 ${px / 2} ${px / 2})`}
          />
        )}
      </Svg>
      <View style={{ width: px * 0.62, alignItems: "center" }}>{children}</View>
    </View>
  )
}

/** A horizontal bar: ``value`` 0–1 of the track filled. */
export function Meter({
  value,
  color,
  height = 1.8,
}: {
  value: number
  color: string
  height?: number
}) {
  const { q, c } = useCard(),
    v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <View
      style={{
        height: height * q,
        borderRadius: height * q,
        backgroundColor: c.track,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          width: `${v * 100}%`,
          height: "100%",
          borderRadius: height * q,
          backgroundColor: color,
        }}
      />
    </View>
  )
}

/** A still trend line (no reveal motion: it is captured as an image). */
export function Spark({
  values,
  height,
  color,
}: {
  values: number[]
  height: number
  color: string
}) {
  const { q } = useCard(),
    px = height * q
  if (values.length < 2) return null
  const min = Math.min(...values),
    span = Math.max(...values) - min || 1,
    points = values
      .map(
        (v, i) =>
          `${(i / (values.length - 1)) * 100},${px - ((v - min) / span) * (px - 4) - 2}`,
      )
      .join(" ")
  return (
    <Svg
      width="100%"
      height={px}
      viewBox={`0 0 100 ${px}`}
      preserveAspectRatio="none"
    >
      <Polygon
        points={`${points} 100,${px} 0,${px}`}
        fill={alpha(color, 0.16)}
      />
      <Polyline
        points={points}
        stroke={color}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        fill="none"
      />
    </Svg>
  )
}

export type Dot = "on" | "part" | "off" | "none"
/** A day grid: one square per day, ``cols`` to a row. */
export function Dots({
  cells,
  cols,
  color,
  width = "100%",
}: {
  cells: Dot[]
  cols: number
  color: string
  /** Narrower on short cards, so a tall grid never crowds the header. */
  width?: `${number}%`
}) {
  const { q, c } = useCard(),
    rows: Dot[][] = []
  for (let i = 0; i < cells.length; i += cols)
    rows.push(cells.slice(i, i + cols))
  return (
    <View style={{ gap: 1.4 * q, width, alignSelf: "center" }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 1.4 * q }}>
          {Array.from({ length: cols }, (_, i) => row[i] ?? null).map(
            (d, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderRadius: q,
                  backgroundColor:
                    d === "on"
                      ? color
                      : d === "part"
                        ? alpha(color, 0.45)
                        : d === "off"
                          ? c.track
                          : "transparent",
                  borderWidth: d === "none" ? 1 : 0,
                  borderColor: c.line,
                }}
              />
            ),
          )}
        </View>
      ))}
    </View>
  )
}

/** The flat lockup: fiddlehead plus "unfurl" in Geist Medium, −3%. */
export function Lockup({ size }: { size: number }) {
  const { q, c } = useCard()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 0.6 * q }}>
      <FernMark size={size * 1.1 * q} color={c.mark} weight={2.2} />
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{
          fontFamily: fonts.medium,
          fontSize: size * q,
          letterSpacing: -0.03 * size * q,
          color: c.ink,
        }}
      >
        unfurl
      </Text>
    </View>
  )
}

/** The card body. It fills the space between header and footer; when what
 * it holds is taller (long names, many rows on a short card), it is scaled
 * down to fit instead of being clipped or drawing over the header. */
function FitBody({ children }: { children: ReactNode }) {
  const [box, setBox] = useState(0),
    [inner, setInner] = useState(0),
    scale = box > 0 && inner > box + 0.5 ? box / inner : 1
  return (
    <View
      testID="card-body"
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
      onLayout={(e) => setBox(e.nativeEvent.layout.height)}
    >
      {/* Absolute, so its height is what the body holds rather than what
          the card allows; at least the card's height, so short bodies
          still fill and centre. A taller one is scaled about its centre,
          then moved up so it starts at the top of the space. */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          minHeight: box,
          transform: [{ translateY: -(inner - inner * scale) / 2 }, { scale }],
        }}
        testID="card-body-fit"
        onLayout={(e) => setInner(e.nativeEvent.layout.height)}
      >
        {/* Bodies are `flex: 1`; here they size to their content (basis
            auto) and grow to fill, never shrinking below what they hold. */}
        {isValidElement<{ style?: ViewStyle }>(children)
          ? cloneElement(children, {
              style: [
                children.props.style,
                { flex: 0, flexGrow: 1, flexShrink: 0, flexBasis: "auto" },
              ] as unknown as ViewStyle,
            })
          : children}
      </View>
    </View>
  )
}
export function CardFrame({
  width,
  look,
  kicker,
  children,
  date,
  foot,
  mark = true,
}: {
  mark?: boolean
  date?: string
  foot?: ReactNode
  width: number
  look: CardLook
  /** Kept for call sites; cards no longer tint their ground by area. */
  accent?: Accent
  kicker: string
  children: ReactNode
}) {
  const q = width / 100,
    c = cardInk(look),
    shot = useContext(CardShotContext)
  return (
    <CardContext.Provider value={{ q, c }}>
      {/* The rounded corners and hairline are on-screen chrome only. The
          exported image is the square-cornered card inside, so a shared PNG
          has no transparent corners for Instagram to fill with notches. */}
      <View
        style={{
          width,
          aspectRatio: 1 / ratioOf(look.format),
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
            padding: 6.5 * q,
            gap: 3 * q,
            overflow: "hidden",
            backgroundColor: c.bg,
          }}
        >
          {look.backdrop === "photo" && look.photo && (
            <>
              <Image
                source={{ uri: look.photo }}
                style={{ position: "absolute", inset: 0 }}
              />
              <View
                style={{
                  position: "absolute",
                  inset: 0,
                  backgroundColor: alpha(c.bg, 0.55),
                }}
              />
            </>
          )}
          <Line style={{ gap: 3 * q, justifyContent: "space-between" }}>
            <View style={{ flexShrink: 1 }}>
              <Words size={3.6} weight="medium" lines={1}>
                {kicker}
              </Words>
            </View>
            {!!date && (
              <View style={{ flexShrink: 1 }}>
                <Words size={3.3} lines={1} align="right" muted>
                  {date}
                </Words>
              </View>
            )}
          </Line>
          <FitBody>{children}</FitBody>
          {(mark || !!foot) && (
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-end",
                gap: 3 * q,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                {typeof foot === "string" ? (
                  <Words size={3} lines={2} muted>
                    {foot}
                  </Words>
                ) : (
                  foot
                )}
              </View>
              {mark && <Lockup size={4.2} />}
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
    </CardContext.Provider>
  )
}

/** The PNG is 1080 pixels wide. iOS view-shot takes the size in points and
 * draws at the screen's scale, so 1080 there would come out 2160 or 3240
 * wide; Android takes pixels. */
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
}) {
  const t = useTheme()
  const [format, setFormat] = useState<CardFormat>("9:16"),
    [backdrop, setBackdrop] = useState<CardBackdrop>("dark"),
    [photo, setPhoto] = useState<string | null>(null),
    [color, setColor] = useState<string>(palette.light.primary)
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
      if (Platform.OS !== "web" && target(value)) {
        const uri = await captureRef(target(value)!, {
          format: "png",
          quality: 1,
          ...exportSize(format),
        })
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: "image/png" })
          return
        }
      }
      await Share.share({ message: caption })
    } catch {
      toast.error("Could not share this image. You can still copy its caption.")
    }
  }
  // Render the selected card to a PNG for the in-app feed/story.
  const capture = async () => {
    const node = target(value)
    if (!node) return null
    try {
      if (Platform.OS === "web")
        return await captureRef(node, { format: "png", result: "data-uri" })
      const uri = await captureRef(node, {
        format: "png",
        quality: 1,
        ...exportSize(format),
      })
      return await keep(uri, "png")
    } catch {
      return null
    }
  }
  const toFeed = async () => {
    const uri = await capture()
    setPostDraft({
      caption,
      media: uri ? [{ kind: "image", uri, ratio: 1 / ratioOf(format) }] : [],
    })
    go(uri ? "/social/compose" : "/social/compose?progress=1")
  }
  const toStory = async () => {
    const uri = await capture()
    if (!uri) {
      toast.error("Couldn't render this card. Try Post instead.")
      return
    }
    addStory({ kind: "image", uri })
    toast.success("Added to your story", {
      action: { label: "View", onClick: () => go("/social/stories/me") },
    })
  }
  if (shareRef) shareRef.current = doShare
  useEffect(() => {
    onLookChange?.({ format, backdrop, photo, color })
  }, [format, backdrop, photo, color, onLookChange])
  const share = () => (beforeShare ? beforeShare(doShare) : doShare())
  const swatch = (key: CardBackdrop) =>
    key === "dark"
      ? palette.dark.background
      : key === "light"
        ? palette.light.background
        : key === "custom"
          ? color
          : t.soft
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
          { label: "Post", Icon: ImagePlus, action: toFeed },
          { label: "Story", Icon: PlusCircle, action: toStory },
          { label: "Save", Icon: Download, action: share },
          { label: "Caption", Icon: CopyIcon, action: () => copyText(caption) },
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
      <Line style={{ justifyContent: "space-between", gap: 4 }}>
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
                backgroundColor: swatch(b.key),
                // Selected: a 2 pt ink outline, never colour alone.
                borderWidth: backdrop === b.key ? 2 : 1,
                borderStyle:
                  b.key === "sticker" && backdrop !== b.key
                    ? "dashed"
                    : "solid",
                borderColor: backdrop === b.key ? t.text : t.input,
              }}
            >
              {b.key === "photo" && (
                <ImageIcon size={18} color={t.text} strokeWidth={1.75} />
              )}
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
      </Line>
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
                  ? "Your photo sits behind the card, dimmed so text stays readable."
                  : "From your library. It sits behind the card, dimmed."}
              </Copy>
            </View>
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
    </View>
  )
}
