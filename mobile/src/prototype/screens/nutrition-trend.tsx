// The Nutrition page's goal history: one nutrient (protein first) day by day
// against its goal, so a glance says how many days hit it lately.
import {
  METRICS,
  type NutrientMetric,
  nutrientHistory,
} from "@domain/fitness/history"
import { fitStore } from "@domain/fitness/store"
import { useState } from "react"
import { ScrollView, View } from "react-native"
import { GrowBar } from "../motion"
import { Copy, Frame, Line, Segmented, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { LockedPreview } from "./locked-preview"

const ORDER: NutrientMetric[] = [
  "protein",
  "kcal",
  "carbs",
  "fat",
  "fiber",
  "satFat",
  "sugar",
  "sodium",
]
const RANGES = [
  { value: "7", label: "7d" },
  { value: "14", label: "14d" },
  { value: "30", label: "30d" },
] as const
const CHART = 128
const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"]

const fmt = (v: number, unit: string) =>
  unit === "mg" || unit === "kcal"
    ? Math.round(v).toLocaleString("en-US")
    : String(Math.round(v))

export function NutritionTrend({
  onPickDay,
}: {
  /** Open that day on the page (tapping a bar). */
  onPickDay?: (day: string) => void
}) {
  const t = useTheme()
  const s = fitStore.use((s) => s)
  const [metric, setMetric] = useState<NutrientMetric>("protein")
  const [range, setRange] = useState<"7" | "14" | "30">("7")
  const h = nutrientHistory(s, metric, Number(range))
  const { label, unit, kind } = METRICS[metric]
  const goal = h.avgGoal
  const top = Math.max(
    1,
    goal ? goal * 1.25 : 0,
    ...h.points.map((p) => p.value ?? 0),
  )
  const colorOf = (status: string) =>
    status === "hit"
      ? t.good
      : status === "over"
        ? t.bad
        : status === "miss"
          ? t.warn
          : t.muted
  const logged = h.points.some((p) => p.value !== null)
  const every = range === "7" ? 1 : range === "14" ? 2 : 5
  const verb =
    kind === "reach"
      ? "goal reached"
      : kind === "under"
        ? "stayed under"
        : "on target"
  return (
    <LockedPreview
      locked={!logged}
      title="Your goal history starts here"
      detail="Log meals for a few days and this shows, day by day, whether you hit your protein and every other goal."
      action={{ label: "Log a meal", href: "/nutrition/new" }}
    >
      <Frame style={{ padding: 16, gap: 12 }}>
        <Line style={{ justifyContent: "space-between" }}>
          <Copy size={12} muted style={{ letterSpacing: 1 }}>
            GOAL HISTORY
          </Copy>
          <View style={{ width: 150 }}>
            <Segmented
              value={range}
              onChange={setRange}
              options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            />
          </View>
        </Line>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginHorizontal: -16 }}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}
        >
          {ORDER.map((m) => {
            const on = m === metric
            return (
              <Tap
                key={m}
                label={`Show ${METRICS[m].label}`}
                onPress={() => setMetric(m)}
                style={{
                  height: 36,
                  paddingHorizontal: 14,
                  borderRadius: 18,
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: on ? t.nut : t.line,
                  backgroundColor: on ? `${t.nut}1f` : "transparent",
                }}
              >
                <Copy
                  size={13}
                  weight={on ? "semibold" : "medium"}
                  style={{ color: on ? t.nut : t.muted }}
                >
                  {METRICS[m].label}
                </Copy>
              </Tap>
            )
          })}
        </ScrollView>
        <View style={{ gap: 2 }}>
          <Line style={{ gap: 6, alignItems: "baseline" }}>
            <Copy size={28} weight="displayMedium">
              {h.judged ? `${h.hit}/${h.judged}` : "—"}
            </Copy>
            <Copy size={13} muted>
              {h.judged || !logged
                ? `days ${label.toLowerCase()} ${verb}`
                : "no goal set for these days"}
            </Copy>
          </Line>
          <Copy size={12} muted>
            {h.avg !== null
              ? `Average ${fmt(h.avg, unit)}${goal ? ` of ${fmt(goal, unit)}` : ""} ${unit} on days you logged`
              : `Nothing logged in the last ${range} days`}
          </Copy>
        </View>
        <View
          accessible
          accessibilityLabel={`${label}, last ${range} days: ${h.hit} of ${h.judged} days ${verb}`}
          style={{ height: CHART, justifyContent: "flex-end" }}
        >
          {goal !== null && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: (goal / top) * CHART,
                borderTopWidth: 1,
                borderStyle: "dashed",
                borderColor: t.muted,
              }}
            />
          )}
          <Line style={{ alignItems: "flex-end", gap: range === "30" ? 2 : 4 }}>
            {h.points.map((p, i) => (
              <Tap
                key={p.day}
                label={`${p.day}: ${
                  p.value === null
                    ? "not logged"
                    : `${fmt(p.value, unit)} ${unit}${p.goal ? ` of ${fmt(p.goal, unit)}` : ""}`
                }`}
                onPress={() => onPickDay?.(p.day)}
                style={{ flex: 1, height: CHART, justifyContent: "flex-end" }}
              >
                {p.value === null ? (
                  <View
                    style={{
                      height: 3,
                      borderRadius: 2,
                      backgroundColor: t.line,
                    }}
                  />
                ) : (
                  <GrowBar
                    index={i}
                    height={Math.max(3, (p.value / top) * CHART)}
                    style={{
                      borderTopLeftRadius: 4,
                      borderTopRightRadius: 4,
                      backgroundColor: colorOf(p.status),
                      opacity: p.status === "open" ? 0.45 : 1,
                    }}
                  />
                )}
              </Tap>
            ))}
          </Line>
        </View>
        <Line style={{ gap: range === "30" ? 2 : 4, marginTop: -4 }}>
          {h.points.map((p, i) => (
            <Copy
              key={p.day}
              size={10}
              muted
              lines={1}
              style={{ flex: 1, textAlign: "center" }}
            >
              {(h.points.length - 1 - i) % every === 0
                ? range === "7"
                  ? WEEKDAY[new Date(`${p.day}T12:00:00`).getDay()]
                  : String(Number(p.day.slice(8)))
                : ""}
            </Copy>
          ))}
        </Line>
        <Line style={{ gap: 12, flexWrap: "wrap" }}>
          {(
            [
              ["hit", kind === "under" ? "Under limit" : "Hit"],
              [
                kind === "under" ? "over" : "miss",
                kind === "under" ? "Over" : "Short",
              ],
              ...(kind === "near" ? [["over", "Over"]] : []),
              ...(h.points.at(-1)?.status === "open"
                ? [["open", "Today so far"]]
                : []),
            ] as [string, string][]
          ).map(([st, text]) => (
            <Line key={st} style={{ gap: 4 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: colorOf(st),
                }}
              />
              <Copy size={11} muted>
                {text}
              </Copy>
            </Line>
          ))}
          {goal !== null && (
            <Line style={{ gap: 4 }}>
              <View
                style={{
                  width: 12,
                  borderTopWidth: 1,
                  borderStyle: "dashed",
                  borderColor: t.muted,
                }}
              />
              <Copy size={11} muted>
                Goal
              </Copy>
            </Line>
          )}
        </Line>
      </Frame>
    </LockedPreview>
  )
}
