import {
  DAILY_LIMITS,
  LIMIT_LABEL,
  type LimitKey,
  limitLevel,
} from "@domain/fitness/limits"
import { Gauge } from "lucide-react-native"
import { View } from "react-native"
import { Copy, Line } from "../native-kit"
import { useTheme } from "../theme"

// Limits read differently from goals on purpose. Goals (calories, protein,
// carbs, fat) are rings that fill toward the target; limits (saturated
// fat, sugar, sodium) are flat bars with a cap line at the daily max,
// headed "Stay under", calm while there is room, amber near the max and
// red past it, and the words say "room" or "over" so colour is never the
// only signal.

export const LIMIT_KEYS = ["satFat", "sugar", "sodium"] as const

/** "day": room left today. "meal": one meal's share of the daily max.
 * "average": a daily average over a range, with the days that went over. */
type Scope = "day" | "meal" | "average"

const fmt = (n: number, unit: string) =>
  unit === "mg"
    ? Math.round(n).toLocaleString("en-US")
    : String(Math.round(n * 10) / 10)

/** One limit. ``scope`` "day" says how much room is left; "meal" says what
 * share of the daily max this one meal uses. ``amount`` undefined means no
 * item logged that day carries the value. */
export function LimitBar({
  k,
  amount,
  scope = "day",
  overDays,
}: {
  k: LimitKey
  amount: number | undefined
  scope?: Scope
  /** For an average: how many of the days went over. */
  overDays?: number
}) {
  const t = useTheme()
  const max = DAILY_LIMITS[k]
  const { label, unit } = LIMIT_LABEL[k]
  const known = amount !== undefined
  const { share, level } = limitLevel(amount ?? 0, max)
  const color = level === "over" ? t.bad : level === "near" ? t.warn : t.muted
  const right = !known
    ? "not tracked yet"
    : scope === "average"
      ? `avg ${fmt(amount, unit)} / ${fmt(max, unit)} ${unit}${overDays ? ` · over on ${overDays} day${overDays === 1 ? "" : "s"}` : " · never over"}`
      : level === "over"
        ? `${fmt(amount, unit)} / ${fmt(max, unit)} ${unit} · ${fmt(amount - max, unit)} ${unit} over`
        : scope === "meal"
          ? `${fmt(amount, unit)} / ${fmt(max, unit)} ${unit} · ${Math.round(share * 100)}% of max`
          : `${fmt(amount, unit)} / ${fmt(max, unit)} ${unit} · ${fmt(max - amount, unit)} ${unit} room`
  return (
    <View
      accessible
      accessibilityLabel={
        known
          ? `${label}: ${fmt(amount, unit)} ${unit} of a ${fmt(max, unit)} ${unit} daily limit, ${level === "over" ? "over the limit" : `${fmt(max - amount, unit)} ${unit} of room left`}`
          : `${label}: not tracked yet`
      }
      style={{ gap: 4 }}
    >
      <Line style={{ justifyContent: "space-between", gap: 8 }}>
        <Copy size={12} weight="medium">
          {label}
        </Copy>
        <Copy
          size={12}
          style={{ color: level === "under" || !known ? t.muted : color }}
        >
          {right}
        </Copy>
      </Line>
      <Line style={{ gap: 0 }}>
        <View
          style={{
            flex: 1,
            height: 6,
            borderTopLeftRadius: 3,
            borderBottomLeftRadius: 3,
            backgroundColor: t.soft,
            overflow: "hidden",
            opacity: known ? 1 : 0.5,
          }}
        >
          <View
            style={{
              width: `${Math.min(1, share) * 100}%`,
              height: 6,
              backgroundColor: color,
            }}
          />
        </View>
        {/* The cap: the line the bar must not cross. */}
        <View
          style={{
            width: 2,
            height: 12,
            borderRadius: 1,
            backgroundColor: level === "over" ? t.bad : t.text,
            opacity: level === "over" ? 1 : 0.55,
          }}
        />
      </Line>
    </View>
  )
}

/** The "Stay under" block: saturated fat, sugar and sodium against their
 * daily max. */
export function LimitList({
  detail,
  scope = "day",
  only = false,
  overDays,
}: {
  detail: Partial<Record<LimitKey, number>>
  scope?: Scope
  overDays?: Partial<Record<LimitKey, number>>
  /** Only the limits a value is known for (a meal card). */
  only?: boolean
}) {
  const t = useTheme()
  const keys = LIMIT_KEYS.filter((k) => !only || detail[k] !== undefined)
  if (!keys.length) return null
  return (
    <View style={{ gap: 8 }}>
      <Line style={{ gap: 6 }}>
        <Gauge size={14} color={t.muted} />
        <Copy size={11} muted weight="semibold" style={{ letterSpacing: 0.6 }}>
          {scope === "meal"
            ? "STAY UNDER · SHARE OF DAILY MAX"
            : scope === "average"
              ? "STAY UNDER · DAILY AVERAGE"
              : "STAY UNDER · TODAY"}
        </Copy>
      </Line>
      {keys.map((k) => (
        <LimitBar
          key={k}
          k={k}
          amount={detail[k]}
          scope={scope}
          overDays={overDays?.[k]}
        />
      ))}
    </View>
  )
}
