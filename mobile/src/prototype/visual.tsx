import { LinearGradient } from "expo-linear-gradient"
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  Dumbbell,
  Ellipsis,
  Eye,
  History,
  type LucideIcon,
  Plus,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Target,
  Wallet,
} from "lucide-react-native"
import { type ReactNode, useId } from "react"
import { Pressable, Text, View } from "react-native"
import Svg, {
  Circle,
  Defs,
  Stop,
  LinearGradient as SvgGradient,
} from "react-native-svg"
import { ArcCircle, CountUp } from "./motion"
import { go } from "./navigation"
import { type Accent, fonts, useTheme } from "./theme"
export const icons = {
  arrow: ArrowRight,
  up: ArrowUp,
  down: ArrowDown,
  back: ChevronLeft,
  bell: Bell,
  journal: BookOpen,
  calendar: CalendarDays,
  check: Check,
  tasks: CheckSquare,
  fitness: Dumbbell,
  privacy: Eye,
  history: History,
  add: Plus,
  search: Search,
  settings: Settings2,
  more: Ellipsis,
  share: Share2,
  sparkle: Sparkles,
  habits: Target,
  finance: Wallet,
}
export type IconName = keyof typeof icons
export function IconButton({
  icon,
  label,
  onPress,
  href,
  accent,
  filled = false,
}: {
  icon: IconName
  label: string
  onPress?: () => void
  href?: string
  accent?: Accent
  filled?: boolean
}) {
  const t = useTheme(),
    Icon = icons[icon]
  return (
    <Pressable
      cssInterop={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (href ? go(href) : onPress?.())}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: filled ? t[accent ?? "primary"] : "transparent",
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Icon
        size={21}
        color={filled ? (t.dark ? t.bg : "white") : accent ? t[accent] : t.text}
      />
    </Pressable>
  )
}
export function Ring({
  value,
  size = 104,
  color,
  children,
  hero = false,
  target,
  strokeWidth,
  gradientColors,
}: {
  value: number
  size?: number
  color?: string
  children?: ReactNode
  hero?: boolean
  target?: number
  strokeWidth?: number
  gradientColors?: [string, string]
}) {
  const gradientId = useId().replaceAll(":", "")
  const t = useTheme(),
    stroke = strokeWidth ?? size * 0.085,
    r = (size - stroke) / 2,
    p = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
      accessible
      accessibilityLabel={`${Math.round(p * 100)} percent`}
    >
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <SvgGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={gradientColors?.[0] ?? t.hab} />
            <Stop offset="1" stopColor={gradientColors?.[1] ?? t.life} />
          </SvgGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={hero ? "#ffffff26" : t.soft}
          strokeWidth={stroke}
          fill="none"
        />
        <ArcCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          value={p}
          stroke={hero ? `url(#${gradientId})` : (color ?? t.accent)}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {target !== undefined && (
          <Circle
            cx={size / 2 + Math.cos(target * 2 * Math.PI - Math.PI / 2) * r}
            cy={size / 2 + Math.sin(target * 2 * Math.PI - Math.PI / 2) * r}
            r={4}
            fill={t.text}
            stroke={t.card}
            strokeWidth={2}
          />
        )}
      </Svg>
      {children}
    </View>
  )
}
export function Section({
  title,
  link,
  href,
}: {
  title: string
  link?: string
  href?: string
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: 16,
        marginBottom: 10,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.medium,
          fontSize: 12,
          letterSpacing: 1,
          color: t.muted,
        }}
      >
        {title.toUpperCase()}
      </Text>
      {href && (
        <Pressable
          accessibilityRole="link"
          onPress={() => go(href)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text
            style={{ fontFamily: fonts.medium, color: t.accent, fontSize: 13 }}
          >
            {link ?? "All"}
          </Text>
        </Pressable>
      )}
    </View>
  )
}
export function Metric({
  value,
  label,
  color,
}: {
  value: string | number
  label: string
  color?: string
}) {
  const t = useTheme()
  return (
    <View style={{ flex: 1, minWidth: 72, gap: 4 }}>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 28,
          color: color ?? t.text,
          fontVariant: ["tabular-nums"],
        }}
      >
        {value}
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 12, color: t.muted }}>
        {label}
      </Text>
    </View>
  )
}
export function Tiles({
  items,
}: {
  items: {
    label: string
    href?: string
    onPress?: () => void
    icon: IconName
    accent: Accent
  }[]
}) {
  const t = useTheme()
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-around",
        gap: 8,
        marginVertical: 12,
      }}
    >
      {items.map((item) => {
        const Icon: LucideIcon = icons[item.icon]
        return (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => (item.href ? go(item.href) : item.onPress?.())}
            style={{ alignItems: "center", gap: 8, flex: 1, minHeight: 76 }}
          >
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 17,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${t[item.accent]}22`,
              }}
            >
              <Icon size={23} color={t[item.accent]} />
            </View>
            <Text
              style={{ fontFamily: fonts.medium, fontSize: 12, color: t.text }}
            >
              {item.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
export function ScoreHero({
  score,
  level,
  delta,
  rates,
}: {
  score: number | null
  level: string
  delta: number | null
  rates: { label: string; value: number; color: string }[]
}) {
  const t = useTheme()
  return (
    <LinearGradient
      colors={[t["hero-from"], t["hero-via"], t["hero-to"]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 24, padding: 20, gap: 18, marginVertical: 8 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
        <Ring value={(score ?? 0) / 100} size={145} hero>
          <CountUp
            value={score}
            style={{ fontFamily: fonts.display, fontSize: 48, color: "white" }}
          />
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 10,
              letterSpacing: 2,
              color: "#ffffffb3",
            }}
          >
            LIFE SCORE
          </Text>
        </Ring>
        <View style={{ flex: 1, gap: 8 }}>
          <Text
            style={{
              fontFamily: fonts.medium,
              fontSize: 10,
              letterSpacing: 2,
              color: "#ffffffb3",
            }}
          >
            LEVEL
          </Text>
          <Text
            style={{ fontFamily: fonts.display, fontSize: 26, color: t.life }}
          >
            {level.toUpperCase()}
          </Text>
          <View
            style={{ height: 6, borderRadius: 3, backgroundColor: "#ffffff26" }}
          />
          <Text
            style={{ fontFamily: fonts.body, fontSize: 12, color: "#ffffffb3" }}
          >
            {delta === null
              ? "Your starting point"
              : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} vs prior period`}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {rates.map((r) => (
          <View key={r.label} style={{ flex: 1, gap: 5 }}>
            <View
              style={{
                height: 6,
                borderRadius: 4,
                backgroundColor: "#ffffff26",
              }}
            >
              <View
                style={{
                  height: 6,
                  borderRadius: 4,
                  width: `${Math.max(0, Math.min(100, r.value * 100))}%`,
                  backgroundColor: r.color,
                }}
              />
            </View>
            <Text
              style={{
                fontFamily: fonts.body,
                fontSize: 10,
                color: "#ffffffcc",
              }}
            >
              {r.label} {Math.round(r.value * 100)}
            </Text>
          </View>
        ))}
      </View>
    </LinearGradient>
  )
}
