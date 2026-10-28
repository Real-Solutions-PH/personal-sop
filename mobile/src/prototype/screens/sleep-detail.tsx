// Sleep in detail: this week (last 7 nights) or this month so far, a bar per
// night you can tap, and the range's average, longest night, nights at 7h
// and nights tracked.
import { useState } from "react"
import { View } from "react-native"
import { DailyBars } from "../chart"
import { healthAvailable } from "../health"
import { Copy, Frame, Segmented } from "../native-kit"
import { useTheme } from "../theme"
import { Empty, Screen } from "../ui"
import { ConnectHealthCard, useHealthAsked } from "./health-connect"
import { hm, sleepStats, useNights } from "./sleep-card"
import { calDay, lastDays, longDay, monthSoFar } from "./steps-card"

type Range = "week" | "month"

export function SleepDetail() {
  const t = useTheme(),
    [range, setRange] = useState<Range>("week"),
    offsets = lastDays(range === "week" ? 7 : monthSoFar()),
    { asked, connect } = useHealthAsked(),
    nights = useNights(offsets, asked),
    [pick, setPick] = useState<number | null>(null)
  if (asked === false)
    return (
      <Screen title="Sleep">
        <ConnectHealthCard onConnect={connect} />
      </Screen>
    )
  const toggle = (
    <Segmented
      value={range}
      onChange={(r: Range) => {
        setRange(r)
        setPick(null)
      }}
      options={[
        { value: "week", label: "Week" },
        { value: "month", label: "Month" },
      ]}
    />
  )
  if (healthAvailable() && !nights)
    return <Screen title="Sleep">{toggle}</Screen>
  const stats = nights ? sleepStats(nights) : undefined
  if (!nights || !stats?.tracked)
    return (
      <Screen title="Sleep">
        {nights && toggle}
        <Empty
          title="No sleep in Apple Health yet"
          detail="Track sleep with an Apple Watch or the Sleep schedule in the Health app, and your nights appear here."
        />
      </Screen>
    )
  const at = pick ?? nights.length - 1,
    shown = nights[at],
    tile = (label: string, value: string) => (
      <View key={label} style={{ width: "46%" }}>
        <Copy size={11} muted>
          {label}
        </Copy>
        <Copy weight="medium">{value}</Copy>
      </View>
    )
  return (
    <Screen title="Sleep">
      {toggle}
      <Frame style={{ padding: 16, gap: 4 }}>
        <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
          {longDay(offsets[at] ?? 0).toUpperCase()}
        </Copy>
        <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
          {shown ? hm(shown) : "—"}
        </Copy>
        <DailyBars
          values={nights.map((m) => m ?? 0)}
          labels={offsets.map((d, i) =>
            range === "week"
              ? new Date(`${calDay(d)}T12:00:00`).toLocaleDateString("en-US", {
                  weekday: "narrow",
                })
              : // A month of bars: label the 1st, every 5th and today.
                i === 0 || (i + 1) % 5 === 0 || i === offsets.length - 1
                ? String(i + 1)
                : "",
          )}
          color={t.fit}
          selected={at}
          onSelect={setPick}
          barLabels={offsets.map(
            (d, i) =>
              `${longDay(d)}: ${nights[i] ? hm(nights[i] ?? 0) : "no sleep tracked"}`,
          )}
        />
      </Frame>
      <Frame style={{ padding: 16 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          {tile("Average", hm(stats.avg))}
          {tile(
            "Longest night",
            stats.best < 0
              ? "—"
              : `${hm(nights[stats.best] ?? 0)} · ${longDay(offsets[stats.best] ?? 0)}`,
          )}
          {tile("Nights at 7h", `${stats.goalNights} of ${stats.tracked}`)}
          {tile("Nights tracked", `${stats.tracked} of ${nights.length}`)}
        </View>
      </Frame>
    </Screen>
  )
}
