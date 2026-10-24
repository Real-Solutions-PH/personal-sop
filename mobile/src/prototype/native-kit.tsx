import * as Haptics from "expo-haptics"
import { ChevronRight, type LucideIcon, Play } from "lucide-react-native"
import { type ReactNode, useEffect, useState } from "react"
import {
  Pressable,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"
import { go } from "./navigation"
import { type Accent, fonts, useTheme } from "./theme"

// Layout primitives translated from frontend/src/proto/ui/kit.tsx.
export function Copy({
  children,
  size = 16,
  muted,
  weight = "body",
  style,
  lines,
}: {
  children: ReactNode
  size?: number
  muted?: boolean
  weight?: "body" | "medium" | "semibold" | "display" | "displayMedium"
  style?: TextStyle
  lines?: number
}) {
  const t = useTheme()
  return (
    <Text
      numberOfLines={lines}
      style={{
        fontFamily: fonts[weight],
        fontVariant: ["tabular-nums"],
        fontSize: size,
        lineHeight:
          (
            {
              10: 15,
              11: 16.5,
              12: 16,
              14: 20,
              16: 24,
              18: 28,
              20: 28,
              24: 32,
              28: 36,
              30: 36,
              36: 40,
              48: 56,
            } as Record<number, number>
          )[size] ?? size * 1.5,
        ...style,
        // A caller passing `color: undefined` keeps the theme colour rather
        // than falling back to the platform's black.
        color: style?.color ?? (muted ? t.muted : t.text),
      }}
    >
      {children}
    </Text>
  )
}
/**
 * A timer's big readout, in Geist Mono. iOS clips glyph tops when
 * `lineHeight` is at or below the font size, so the line keeps 1.25× room;
 * one line that shrinks to fit `width` rather than wrap or spill out of a
 * ring, and Dynamic Type grows it only so far.
 */
export function Countdown({
  children,
  size,
  width,
  style,
}: {
  children: ReactNode
  size: number
  width?: number
  style?: TextStyle
}) {
  const t = useTheme()
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.4}
      maxFontSizeMultiplier={1.4}
      style={{
        fontFamily: fonts.mono,
        fontVariant: ["tabular-nums"],
        fontSize: size,
        lineHeight: Math.ceil(size * 1.25),
        letterSpacing: -0.02 * size,
        textAlign: "center",
        maxWidth: width,
        ...style,
        color: style?.color ?? t.text,
      }}
    >
      {children}
    </Text>
  )
}
export function Line({
  children,
  style,
}: {
  children: ReactNode
  style?: ViewStyle
}) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 12, ...style }}
    >
      {children}
    </View>
  )
}
// NativeWind flattens callback styles into empty objects on native. These
// controls use React Native styles directly, so bypass className conversion.
export function Tap({
  children,
  onPress,
  label,
  style,
  role = "button",
  selected,
}: {
  children: ReactNode
  onPress: () => void
  label?: string
  style?: ViewStyle
  role?: "button" | "radio"
  selected?: boolean
}) {
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole={role}
      accessibilityState={selected === undefined ? undefined : { selected }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        { opacity: pressed ? 0.65 : 1 },
        style,
        pressed && { transform: [{ scale: 0.97 }] },
      ]}
    >
      {children}
    </Pressable>
  )
}
export function IconTap({
  icon: Icon,
  label,
  onPress,
  color,
  background,
  size = 36,
}: {
  icon: LucideIcon
  label: string
  onPress: () => void
  color?: string
  background?: string
  size?: number
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      label={label}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
      }}
    >
      <Icon
        size={size === 44 || size === 40 ? 20 : 16}
        color={color ?? t.muted}
        fill={Icon === Play ? color : "none"}
      />
    </Tap>
  )
}
// A bar control that never shows a cut-off label. The label is measured at
// the phone's own text size: while it fits whole it is shown, and when it
// would be truncated the button keeps only its icon. The full name is the
// accessibility label either way, and the touch target is at least 44pt.
// Sizing: `width` fixes it, `max` lets it hug its content up to that width,
// and with neither it fills the space its parent gives it (`style.flex`).
export function ToolButton({
  icon: Icon,
  label,
  name = label,
  onPress,
  disabled = false,
  tone = "quiet",
  keepIcon = false,
  stacked = false,
  width,
  max,
  style,
}: {
  icon: LucideIcon
  label: string
  /** The full name for screen readers, when the label is a short form. */
  name?: string
  onPress: () => void
  disabled?: boolean
  tone?: "quiet" | "primary"
  /** Shows the icon beside (or above) the label while the label fits. */
  keepIcon?: boolean
  stacked?: boolean
  width?: number
  max?: number
  style?: ViewStyle
}) {
  const t = useTheme()
  const [box, setBox] = useState(0)
  const [need, setNeed] = useState(0)
  const pad = stacked ? 6 : 12,
    room = width ?? max ?? box,
    fits =
      need > 0 &&
      room > 0 &&
      need + (keepIcon && !stacked ? 22 : 0) + pad * 2 <= room,
    color = tone === "primary" ? (t.dark ? t.bg : "#FFF") : t.text,
    text: TextStyle = {
      fontFamily: fonts.semibold,
      fontSize: stacked ? 12 : 14,
      color,
    }
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onLayout={
        width || max ? undefined : (e) => setBox(e.nativeEvent.layout.width)
      }
      onPress={() => {
        void Haptics.selectionAsync().catch(() => {})
        onPress()
      }}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        width,
        maxWidth: max,
        flexDirection: stacked ? "column" : "row",
        gap: stacked ? 4 : 6,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: pad,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: tone === "primary" ? t.accent : t.soft,
        opacity: disabled ? 0.3 : pressed ? 0.8 : 1,
        ...style,
      })}
    >
      {(keepIcon || !fits) && <Icon size={stacked ? 20 : 18} color={color} />}
      {fits && (
        <Text numberOfLines={1} style={text}>
          {label}
        </Text>
      )}
      <Measure text={label} style={text} onWidth={setNeed} />
    </Pressable>
  )
}
/** Lays a label out off-screen, unconstrained, and reports its natural width
 * at the phone's current text size. Hidden from screen readers; the parent
 * should clip overflow so it never widens the page. */
export function Measure({
  text,
  style,
  onWidth,
}: {
  text: string
  style: TextStyle
  onWidth: (width: number) => void
}) {
  return (
    <View
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1000,
        flexDirection: "row",
        opacity: 0,
      }}
    >
      <Text
        style={style}
        onLayout={(e) => onWidth(Math.ceil(e.nativeEvent.layout.width))}
      >
        {text}
      </Text>
    </View>
  )
}
export function SmallButton({
  children,
  onPress,
  accent,
  quiet,
  icon: Icon,
  small = false,
}: {
  children: ReactNode
  onPress: () => void
  accent: Accent
  quiet?: boolean
  icon?: LucideIcon
  small?: boolean
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={onPress}
      style={{
        height: small ? 32 : 36,
        paddingHorizontal: small ? 10 : 12,
        borderRadius: 12,
        backgroundColor: quiet ? t.soft : t[accent],
        justifyContent: "center",
      }}
    >
      <Line style={{ gap: 6, justifyContent: "center" }}>
        {Icon && <Icon size={16} color={quiet ? t.text : t.onPrimary} />}
        <Copy
          size={small ? 12 : 14}
          weight="medium"
          style={{ color: quiet ? t.text : t.onPrimary }}
        >
          {children}
        </Copy>
      </Line>
    </Tap>
  )
}
export function Frame({
  children,
  style,
}: {
  children: ReactNode
  style?: ViewStyle
}) {
  const t = useTheme()
  // A padded card holds content (text, then a button), so its children get
  // room between them. Unpadded or lightly padded cards hold divided rows,
  // which space themselves. An explicit `gap` in `style` wins.
  const pad = typeof style?.padding === "number" ? style.padding : 0
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border(t.line, 0.6),
        backgroundColor: t.card,
        overflow: "hidden",
        gap: pad >= 16 ? 10 : pad >= 12 ? 6 : undefined,
        ...style,
      }}
    >
      {children}
    </View>
  )
}
export function border(color: string, opacity: number) {
  const alpha =
    color.length === 9 ? Number.parseInt(color.slice(7), 16) / 255 : 1
  return `${color.slice(0, 7)}${Math.round(alpha * opacity * 255)
    .toString(16)
    .padStart(2, "0")}`
}
export function Group({
  title,
  icon: Icon,
  accent,
  href,
  children,
}: {
  title: string
  icon: LucideIcon
  accent: Accent
  href: string
  children: ReactNode
}) {
  const t = useTheme()
  return (
    <Frame>
      <Tap
        onPress={() => go(href)}
        style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}
      >
        <Line style={{ gap: 10 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: `${t[accent]}26`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={16} color={t[accent]} />
          </View>
          <Copy weight="semibold" style={{ flex: 1 }}>
            {title}
          </Copy>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Tap>
      {children}
    </Frame>
  )
}
export function Part({
  children,
  style,
}: {
  children: ReactNode
  style?: ViewStyle
}) {
  const t = useTheme()
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: border(t.line, 0.5),
        paddingHorizontal: 16,
        paddingVertical: 12,
        ...style,
      }}
    >
      {children}
    </View>
  )
}
export function Bar({
  value,
  color,
  target,
  height = 8,
}: {
  value: number
  color: string
  target?: number
  height?: number
}) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, height, backgroundColor: t.soft, borderRadius: 4 }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height,
          borderRadius: 4,
          backgroundColor: color,
        }}
      />
      {target !== undefined && (
        <View
          style={{
            position: "absolute",
            left: `${target * 100}%`,
            top: -4,
            height: 16,
            width: 2,
            borderRadius: 1,
            backgroundColor: border(t.text, 0.7),
            transform: [{ translateX: -1 }],
          }}
        />
      )}
    </View>
  )
}

export function SectionHeading({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Line
      style={{
        justifyContent: "space-between",
        marginTop: 24,
        marginBottom: 8,
        paddingHorizontal: 4,
      }}
    >
      <Copy
        size={12}
        weight="medium"
        muted
        style={{ letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {typeof children === "string" ? children.toUpperCase() : children}
      </Copy>
      {action}
    </Line>
  )
}
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const [width, setWidth] = useState(0)
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const segment = width ? (width - 8) / options.length : 0
  const x = useSharedValue(index * segment)
  useEffect(() => {
    x.value = reduced
      ? index * segment
      : withSpring(index * segment, { damping: 22, stiffness: 260 })
  }, [index, segment, reduced, x])
  // A single pill slides between options, like a native segmented control.
  const pill = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: t.soft,
        padding: 4,
        borderRadius: 12,
      }}
    >
      {segment > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 4,
              top: 4,
              bottom: 4,
              width: segment,
              borderRadius: 8,
              backgroundColor: t.bg,
              boxShadow: "0px 1px 3px #00000022",
            },
            pill,
          ]}
        />
      )}
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityLabel={typeof o.label === "string" ? o.label : o.value}
          accessibilityState={{ selected: value === o.value }}
          onPress={() => {
            if (o.value !== value) void Haptics.selectionAsync().catch(() => {})
            onChange(o.value)
          }}
          style={{
            flex: 1,
            minHeight: 40,
            paddingHorizontal: 8,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor:
              segment > 0 || value !== o.value ? "transparent" : t.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy size={14} weight="medium" muted={value !== o.value}>
            {o.label}
          </Copy>
        </Pressable>
      ))}
    </View>
  )
}
export function LinkRow({
  title,
  detail,
  icon: Icon,
  accent,
  href,
  right,
  onPress,
}: {
  title: string
  detail?: string
  icon?: LucideIcon
  accent?: Accent
  href?: string
  right?: ReactNode
  onPress?: () => void
}) {
  const t = useTheme()
  return (
    <Tap
      onPress={() => (href ? go(href) : onPress?.())}
      style={{ paddingHorizontal: 8, paddingVertical: 12 }}
    >
      <Line>
        {Icon && (
          <View
            style={{
              height: 36,
              width: 36,
              borderRadius: 12,
              backgroundColor: accent ? `${t[accent]}26` : t.soft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon size={16} color={accent ? t[accent] : t.muted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Copy weight="medium">{title}</Copy>
          {detail && (
            <Copy size={12} muted>
              {detail}
            </Copy>
          )}
        </View>
        {right ?? <ChevronRight size={16} color={t.muted} />}
      </Line>
    </Tap>
  )
}
