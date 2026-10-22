import { targetFor } from "@domain/fitness/calc"
import {
  LIMIT_LABEL,
  type LimitKey,
  type Limits,
  limitLevel,
  limitsFor,
} from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { dayKey } from "@domain/lib/day"
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

/** Today's limits: the user's own from the target in force, else the WHO
 * defaults. For a surface that has no day of its own (a meal card). */
export function useTodayLimits(): Limits {
  const target = fitStore.use((s) => targetFor(s, dayKey()))
  return limitsFor(target)
}

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
  max,
  scope = "day",
  overDays,
}: {
  k: LimitKey
  amount: number | undefined
  /** The daily limit this amount is held against. */
  max: number
  scope?: Scope
  /** For an average: how many of the days went over. */
  overDays?: number
}) {
  const t = useTheme()
  const { label, unit } = LIMIT_LABEL[k]
  const known = amount !== undefined
  const { share, level } = limitLevel(amount ?? 0, max)
  const color = level === "over" ? t.bad : level === "near" ? t.warn : t.muted
  const right = !known
    ? `not tracked yet · under ${fmt(max, unit)} ${unit}`
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
          : `${label}: not tracked yet, daily limit ${fmt(max, unit)} ${unit}`
      }
      style={{ gap: 4 }}
    >
      {/* On a narrow card the figures wrap under their own width rather
          than run into the label. */}
      <Line
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
        }}
      >
        <Copy size={12} weight="medium">
          {label}
        </Copy>
        <Copy
          size={12}
          style={{
            flexShrink: 1,
            textAlign: "right",
            color: level === "under" || !known ? t.muted : color,
          }}
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
 * daily max: ``limits`` when given (the day's target), else today's. */
export function LimitList({
  detail,
  limits,
  scope = "day",
  only = false,
  overDays,
}: {
  detail: Partial<Record<LimitKey, number>>
  limits?: Limits
  scope?: Scope
  overDays?: Partial<Record<LimitKey, number>>
  /** Only the limits a value is known for (a meal card). */
  only?: boolean
}) {
  const t = useTheme()
  const today = useTodayLimits()
  const max = limits ?? today
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
          max={max[k]}
          scope={scope}
          overDays={overDays?.[k]}
        />
      ))}
    </View>
  )
}
