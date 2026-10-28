// Steps from Apple Health on Fitness: the selected day's count (today until
// a bar is tapped), this week's and this month's daily averages, and a bar
// per day. Read-only; nothing is synced.
import { dayOffset } from "@domain/lib/day"
import { ChevronRight } from "lucide-react-native"
import { useCallback, useEffect, useState } from "react"
import { AppState, View } from "react-native"
import { DailyBars } from "../chart"
import { type Activity, healthAvailable, readActivity } from "../health"
import { Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"

export const GOAL = 10_000
export const n = (v: number) => v.toLocaleString("en-US")
/** "Tue, Oct 27" for a dayOffset. */
export const longDay = (offset: number) =>
  new Date(`${dayOffset(offset)}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
/** Offsets from `count - 1` days ago up to today, oldest first. */
export const lastDays = (count: number) =>
  Array.from({ length: count }, (_, i) => i - count + 1)
/** Days so far this month, today included. */
export const monthSoFar = () => Number(dayOffset(0).slice(8))

/** A run of days, oldest first; a day Health had nothing for counts as 0.
 * best: the index of the day with the most steps, -1 if none. */
export function stepStats(days: readonly (Activity | null)[]) {
  const steps = days.map((a) => a?.steps ?? 0),
    total = steps.reduce((a, b) => a + b, 0),
    top = Math.max(0, ...steps)
  return {
    total,
    avg: days.length ? Math.round(total / days.length) : 0,
    best: top > 0 ? steps.indexOf(top) : -1,
    km:
      Math.round(days.reduce((a, d) => a + (d?.distanceKm ?? 0), 0) * 10) / 10,
    kcal: days.reduce((a, d) => a + (d?.activeKcal ?? 0), 0),
    goalDays: steps.filter((s) => s >= GOAL).length,
  }
}

/** Reads `offsets` from Health now and whenever the app comes back. */
export function useDays(offsets: readonly number[]) {
  const available = healthAvailable(),
    key = offsets.join(","),
    [days, setDays] = useState<(Activity | null)[] | undefined>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for offsets
  const load = useCallback(async () => {
    setDays(await Promise.all(offsets.map((d) => readActivity(dayOffset(d)))))
  }, [key])
  useEffect(() => {
    if (!available) return
    void load()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load()
    })
    return () => sub.remove()
  }, [available, load])
  return available ? days : undefined
}

export function StepsCard() {
  const t = useTheme(),
    // ponytail: one Health read per day (4 queries each); a statistics
    // collection query if a month of reads ever feels slow.
    span = lastDays(Math.max(7, monthSoFar())),
    days = useDays(span),
    [pick, setPick] = useState(6)
  if (!days) return null
  const week = days.slice(-7),
    month = days.slice(-monthSoFar()),
    weekOffsets = span.slice(-7),
    shown = week[pick],
    isToday = pick === 6,
    avg = (label: string, v: number) => (
      <View
        accessible
        accessibilityLabel={`${label}: ${n(v)} steps a day on average`}
        style={{ flex: 1 }}
      >
        <Copy size={11} muted>
          {label}
        </Copy>
        <Copy weight="medium">{n(v)}</Copy>
      </View>
    )
  return (
    <Frame style={{ padding: 16, marginTop: 16, gap: 4 }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
          {isToday
            ? "STEPS TODAY"
            : `STEPS · ${longDay(weekOffsets[pick] ?? 0).toUpperCase()}`}
        </Copy>
        <Tap label="Step details" onPress={() => go("/fitness/steps")}>
          <Line style={{ gap: 2 }}>
            <Copy size={12} style={{ color: t.fit }}>
              Details
            </Copy>
            <ChevronRight size={14} color={t.fit} />
          </Line>
        </Tap>
      </Line>
      <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
        {n(shown?.steps ?? 0)}
      </Copy>
      <Copy size={12} muted>
        {`${shown?.distanceKm ?? 0} km ${isToday ? "today" : "that day"}`}
      </Copy>
      <Line style={{ marginTop: 8 }}>
        {avg("This week", stepStats(week).avg)}
        {avg("This month", stepStats(month).avg)}
      </Line>
      <DailyBars
        values={week.map((a) => a?.steps ?? 0)}
        labels={weekOffsets.map((d) =>
          new Date(`${dayOffset(d)}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "narrow",
          }),
        )}
        color={t.fit}
        selected={pick}
        onSelect={setPick}
        barLabels={weekOffsets.map(
          (d, i) => `${longDay(d)}: ${n(week[i]?.steps ?? 0)} steps`,
        )}
      />
    </Frame>
  )
}
