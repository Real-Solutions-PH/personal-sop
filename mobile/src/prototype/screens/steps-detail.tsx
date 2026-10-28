// Steps in detail: this week (last 7 days) or this month so far, a bar per
// day you can tap, and the range's totals, average, best day, distance,
// active kcal and days at 10,000 steps.
import { dayOffset } from "@domain/lib/day"
import { useState } from "react"
import { View } from "react-native"
import { DailyBars } from "../chart"
import { Copy, Frame, Segmented } from "../native-kit"
import { useTheme } from "../theme"
import { Empty, Screen } from "../ui"
import {
  GOAL,
  lastDays,
  longDay,
  monthSoFar,
  n,
  stepStats,
  useDays,
} from "./steps-card"

type Range = "week" | "month"

export function StepsDetail() {
  const t = useTheme(),
    [range, setRange] = useState<Range>("week"),
    offsets = lastDays(range === "week" ? 7 : monthSoFar()),
    days = useDays(offsets),
    [pick, setPick] = useState<number | null>(null)
  const changeRange = (r: Range) => {
    setRange(r)
    setPick(null)
  }
  if (!days)
    return (
      <Screen title="Steps">
        <Empty
          title="Apple Health isn't connected"
          detail="Steps appear here once Unfurl can read Apple Health."
        />
      </Screen>
    )
  const stats = stepStats(days),
    at = pick ?? days.length - 1,
    shown = days[at],
    tile = (label: string, value: string) => (
      <View key={label} style={{ width: "46%" }}>
        <Copy size={11} muted>
          {label}
        </Copy>
        <Copy weight="medium">{value}</Copy>
      </View>
    )
  return (
    <Screen title="Steps">
      <Segmented
        value={range}
        onChange={changeRange}
        options={[
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
        ]}
      />
      <Frame style={{ padding: 16, gap: 4 }}>
        <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
          {longDay(offsets[at] ?? 0).toUpperCase()}
        </Copy>
        <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
          {n(shown?.steps ?? 0)}
        </Copy>
        <Copy size={12} muted>
          {`${shown?.distanceKm ?? 0} km · ${n(shown?.activeKcal ?? 0)} kcal burned`}
        </Copy>
        <DailyBars
          values={days.map((a) => a?.steps ?? 0)}
          labels={offsets.map((d, i) =>
            range === "week"
              ? new Date(`${dayOffset(d)}T12:00:00`).toLocaleDateString(
                  "en-US",
                  { weekday: "narrow" },
                )
              : // A month of bars: label the 1st, every 5th and today.
                i === 0 || (i + 1) % 5 === 0 || i === offsets.length - 1
                ? String(i + 1)
                : "",
          )}
          color={t.fit}
          selected={at}
          onSelect={setPick}
          barLabels={offsets.map(
            (d, i) => `${longDay(d)}: ${n(days[i]?.steps ?? 0)} steps`,
          )}
        />
      </Frame>
      <Frame style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {tile("Total steps", n(stats.total))}
          {tile("Daily average", n(stats.avg))}
          {tile(
            "Best day",
            stats.best < 0
              ? "—"
              : `${n(days[stats.best]?.steps ?? 0)} · ${longDay(offsets[stats.best] ?? 0)}`,
          )}
          {tile(`Days at ${n(GOAL)}`, `${stats.goalDays} of ${days.length}`)}
          {tile("Distance", `${stats.km} km`)}
          {tile("Active energy", `${n(stats.kcal)} kcal`)}
        </View>
      </Frame>
    </Screen>
  )
}
