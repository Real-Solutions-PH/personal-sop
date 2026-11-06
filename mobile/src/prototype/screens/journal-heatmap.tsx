import { dayKey, weekday } from "@domain/lib/day"
import { Text, View } from "react-native"
import { border, Copy, Line } from "../native-kit"
import { fonts, useTheme } from "../theme"

/** The calendar day `n` days from `key`, counted at local noon so a
 * daylight-saving change never lands it on the wrong date. */
const addDays = (key: string, n: number) => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + n)
  const p = (x: number) => String(x).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Entries in a day, bucketed for the cell's strength: none, one, two,
 * three or more. */
export const heatLevel = (n: number) => (n <= 0 ? 0 : n >= 3 ? 3 : n)

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]
const WEEKDAY_NAMES = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
]

const date = (day: string, o: Intl.DateTimeFormatOptions) =>
  new Date(`${day}T12:00:00`).toLocaleDateString("en-PH", o)

/** The days the grid draws: whole weeks (Sunday first) from the week holding
 * the first of the last `days` days through the week holding today. A day
 * outside the window is `null`, drawn as an empty slot. */
export function heatDays(today: string, days = 28) {
  const first = addDays(today, -(days - 1)),
    start = addDays(first, -weekday(first)),
    out: (string | null)[] = []
  for (let d = start; out.length % 7 || d <= today; d = addDays(d, 1))
    out.push(d < first || d > today ? null : d)
  return out
}

/** The best weekday by days written, once there is enough to say so. */
function bestWeekday(counts: Map<string, number>, days: string[]) {
  const per = Array.from({ length: 7 }, () => 0)
  for (const d of days) if ((counts.get(d) ?? 0) > 0) per[weekday(d)] += 1
  const top = Math.max(...per)
  if (top < 3 || per.filter((n) => n === top).length > 1) return null
  return WEEKDAY_NAMES[per.indexOf(top)]
}

/** The Journal's last four weeks (card library, Heatmap): one rounded cell
 * per day, weekdays across and weeks down with the week's date on the left,
 * the area colour from faint (one entry) to full (three or more), and today
 * ringed in ink. Each cell carries its day of the month, so a day can be
 * found without counting, and a readout of what it counts. */
export function JournalHeatmap({
  counts,
  today = dayKey(),
  days = 28,
}: {
  /** Entries per day (`YYYY-MM-DD` → count). */
  counts: Map<string, number>
  today?: string
  days?: number
}) {
  const t = useTheme(),
    grid = heatDays(today, days),
    first = addDays(today, -(days - 1)),
    // Each row is labelled with its Sunday, the first row included.
    gridStart = addDays(first, -weekday(first)),
    inWindow = grid.filter((d): d is string => !!d),
    written = inWindow.filter((d) => (counts.get(d) ?? 0) > 0).length,
    best = bestWeekday(counts, inWindow),
    // Faint to full in the area colour; an empty day is the muted fill.
    fills = [
      t.soft,
      border(t.life, 0.35),
      border(t.life, 0.65),
      t.life,
    ] as const
  const label = (d: string) => {
    const n = counts.get(d) ?? 0
    return `${date(d, { weekday: "short", day: "numeric", month: "short" })}${d === today ? ", today" : ""}: ${n ? `${n} ${n === 1 ? "entry" : "entries"}` : "nothing written"}`
  }
  return (
    <View style={{ gap: 4, marginTop: 16 }} testID="journal-heatmap">
      <Line style={{ gap: 4 }}>
        <View style={{ width: 44 }} />
        {WEEKDAYS.map((w, i) => (
          <Copy
            key={`${w}${i}`}
            size={11}
            muted
            style={{ flex: 1, textAlign: "center" }}
          >
            {w}
          </Copy>
        ))}
      </Line>
      {Array.from({ length: grid.length / 7 }, (_, week) => {
        const row = grid.slice(week * 7, week * 7 + 7),
          sunday = addDays(gridStart, week * 7)
        return (
          <Line key={week} style={{ gap: 4 }}>
            <Text
              style={{
                width: 44,
                fontFamily: fonts.monoRegular,
                fontSize: 11,
                color: t.muted,
              }}
            >
              {date(sunday, { day: "numeric", month: "short" })}
            </Text>
            {row.map((d, i) => {
              // Every slot is the same flexible column, filled or not, so
              // a short last week stays under the weekdays above it.
              if (!d)
                return <View key={`empty-${week}-${i}`} style={{ flex: 1 }} />
              const level = heatLevel(counts.get(d) ?? 0),
                isToday = d === today
              return (
                <View
                  key={d}
                  testID={`heat-${d}`}
                  accessible
                  accessibilityLabel={label(d)}
                  accessibilityValue={{ min: 0, max: 3, now: level }}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    backgroundColor: fills[level],
                    borderWidth: isToday ? 2 : 0,
                    borderColor: t.text,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={{
                      fontFamily: isToday ? fonts.mono : fonts.monoRegular,
                      fontSize: 11,
                      color:
                        level === 3
                          ? t.onPrimary
                          : level === 0
                            ? t.muted
                            : t.text,
                    }}
                  >
                    {Number(d.slice(8))}
                  </Text>
                </View>
              )
            })}
          </Line>
        )
      })}
      <Line
        style={{
          marginTop: 6,
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <Line style={{ gap: 4 }} testID="journal-heatmap-legend">
          <Copy size={11} muted>
            Less
          </Copy>
          {fills.map((f, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                backgroundColor: f,
              }}
            />
          ))}
          <Copy size={11} muted>
            More
          </Copy>
        </Line>
        <Copy size={12} muted>
          <Text style={{ color: t.text, fontFamily: fonts.medium }}>
            {written}
          </Text>{" "}
          of {inWindow.length} days written
          {best ? ` · best on ${best}` : ""}
        </Copy>
      </Line>
    </View>
  )
}

/** Days written in a window, for callers that hold entries by day. */
export const countByDay = (days: string[]) => {
  const m = new Map<string, number>()
  for (const d of days) m.set(d, (m.get(d) ?? 0) + 1)
  return m
}
