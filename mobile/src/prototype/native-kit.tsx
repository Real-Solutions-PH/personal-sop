import { ChevronRight, type LucideIcon, Play } from "lucide-react-native"
import type { ReactNode } from "react"
import {
  Pressable,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native"
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
              48: 48,
            } as Record<number, number>
          )[size] ?? size * 1.5,
        color: muted ? t.muted : t.text,
        ...style,
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
}: {
  children: ReactNode
  onPress: () => void
  label?: string
  style?: ViewStyle
}) {
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, ...style })}
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
      <Line style={{ gap: 6 }}>
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
  return (
    <View
      style={{
        borderRadius: 16,
        borderWidth: 1,
        borderColor: border(t.line, 0.6),
        backgroundColor: t.card,
        overflow: "hidden",
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
  return (
    <Line
      style={{ backgroundColor: t.soft, padding: 4, borderRadius: 12, gap: 0 }}
    >
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityLabel={typeof o.label === "string" ? o.label : o.value}
          accessibilityState={{ selected: value === o.value }}
          onPress={() => onChange(o.value)}
          style={{
            flex: 1,
            minHeight: 40,
            paddingHorizontal: 8,
            paddingVertical: 8,
            borderRadius: 8,
            backgroundColor: value === o.value ? t.bg : "transparent",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: value === o.value ? "0px 1px 2px #0000000d" : undefined,
          }}
        >
          <Copy size={14} weight="medium" muted={value !== o.value}>
            {o.label}
          </Copy>
        </Pressable>
      ))}
    </Line>
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
