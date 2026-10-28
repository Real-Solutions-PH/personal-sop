// Sleep from Apple Health: Fitness's card (last night until a bar is tapped,
// this week's average, a bar per night) and a row on Today's Fitness group.
// A night belongs to the day you wake. Read-only; nothing is synced. Renders nothing until Health
// is allowed (Steps shows the Connect button) or when no night is tracked.
import { ChevronRight } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { DailyBars } from "../chart"
import { readSleep } from "../health"
import { Copy, Frame, Line, Part, Tap } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { useHealthAsked } from "./health-connect"
import { calDay, lastDays, longDay, useHealthDays } from "./steps-card"

export const SLEEP_GOAL = 420
/** "7h 05m" */
export const hm = (min: number) =>
  `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, "0")}m`

/** A run of nights, oldest first. A night Health had nothing for (null or 0)
 * is untracked and left out of the average, never counted as 0h.
 * best: the index of the longest night, -1 if none. */
export function sleepStats(nights: readonly (number | null)[]) {
  const tracked = nights.filter((m): m is number => !!m),
    top = Math.max(0, ...tracked)
  return {
    avg: tracked.length
      ? Math.round(tracked.reduce((a, b) => a + b, 0) / tracked.length)
      : 0,
    best: top > 0 ? nights.indexOf(top) : -1,
    goalNights: tracked.filter((m) => m >= SLEEP_GOAL).length,
    tracked: tracked.length,
  }
}

export const useNights = (
  offsets: readonly number[],
  ready: boolean | undefined,
) => useHealthDays(offsets, ready, readSleep)

/** Today's row inside the Fitness group: last night and the week's average. */
export function SleepPart() {
  const t = useTheme(),
    { asked } = useHealthAsked(),
    nights = useNights(lastDays(7), asked)
  if (!nights || sleepStats(nights).tracked === 0) return null
  const last = nights.at(-1)
  return (
    <Part>
      <Tap label="Sleep details" onPress={() => go("/fitness/sleep")}>
        <Line>
          <View style={{ flex: 1 }}>
            <Copy weight="semibold">
              {last
                ? `${hm(last)} sleep last night`
                : "No sleep tracked last night"}
            </Copy>
            <Copy size={14} muted>
              {`7-night avg ${hm(sleepStats(nights).avg)}`}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Tap>
    </Part>
  )
}

export function SleepCard() {
  const t = useTheme(),
    offsets = lastDays(7),
    { asked } = useHealthAsked(),
    nights = useNights(offsets, asked),
    [pick, setPick] = useState(6)
  if (!nights || sleepStats(nights).tracked === 0) return null
  const shown = nights[pick] ?? 0,
    isLast = pick === 6,
    avg = sleepStats(nights).avg
  return (
    <Frame style={{ padding: 16, marginTop: 16, gap: 4 }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
          {isLast
            ? "LAST NIGHT"
            : `SLEEP · ${longDay(offsets[pick] ?? 0).toUpperCase()}`}
        </Copy>
        <Tap label="Sleep details" onPress={() => go("/fitness/sleep")}>
          <Line style={{ gap: 2 }}>
            <Copy size={12} style={{ color: t.fit }}>
              Details
            </Copy>
            <ChevronRight size={14} color={t.fit} />
          </Line>
        </Tap>
      </Line>
      <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
        {shown ? hm(shown) : "—"}
      </Copy>
      <View
        accessible
        accessibilityLabel={`This week: ${hm(avg)} a night on average`}
        style={{ marginTop: 8 }}
      >
        <Copy size={11} muted>
          This week
        </Copy>
        <Copy weight="medium">{hm(avg)}</Copy>
      </View>
      <DailyBars
        values={nights.map((m) => m ?? 0)}
        labels={offsets.map((d) =>
          new Date(`${calDay(d)}T12:00:00`).toLocaleDateString("en-US", {
            weekday: "narrow",
          }),
        )}
        color={t.fit}
        selected={pick}
        onSelect={setPick}
        barLabels={offsets.map(
          (d, i) =>
            `${longDay(d)}: ${nights[i] ? hm(nights[i] ?? 0) : "no sleep tracked"}`,
        )}
      />
    </Frame>
  )
}
