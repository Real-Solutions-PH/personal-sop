// Fitness's steps card: today's count and the last seven days from Apple
// Health, like the Health app's summary. Read-only; nothing is synced.
import { dayOffset } from "@domain/lib/day"
import { useCallback, useEffect, useState } from "react"
import { AppState, View } from "react-native"
import { DailyBars } from "../chart"
import { type Activity, healthAvailable, readActivity } from "../health"
import { Copy, Frame, Line } from "../native-kit"
import { useTheme } from "../theme"

const DAYS = [6, 5, 4, 3, 2, 1, 0].map((n) => -n) // oldest → today
const n = (v: number) => v.toLocaleString("en-US")

export function StepsCard() {
  const t = useTheme(),
    available = healthAvailable(),
    [week, setWeek] = useState<(Activity | null)[] | undefined>()
  const load = useCallback(async () => {
    setWeek(await Promise.all(DAYS.map((d) => readActivity(dayOffset(d)))))
  }, [])
  useEffect(() => {
    if (!available) return
    void load()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void load()
    })
    return () => sub.remove()
  }, [available, load])
  if (!available || !week) return null
  const steps = week.map((a) => a?.steps ?? 0),
    today = week.at(-1),
    avg = Math.round(steps.reduce((a, b) => a + b, 0) / steps.length)
  return (
    <Frame style={{ padding: 16, marginTop: 16, gap: 4 }}>
      <Line style={{ justifyContent: "space-between" }}>
        <Copy size={12} muted style={{ letterSpacing: 0.6 }}>
          STEPS TODAY
        </Copy>
        <Copy size={12} muted>
          Apple Health
        </Copy>
      </Line>
      <Copy size={30} weight="displayMedium" style={{ color: t.fit }}>
        {n(today?.steps ?? 0)}
      </Copy>
      <Copy size={12} muted>
        {`Avg ${n(avg)} a day · ${today?.distanceKm ?? 0} km today`}
      </Copy>
      <View>
        <DailyBars
          values={steps}
          labels={DAYS.map((d) =>
            new Date(`${dayOffset(d)}T12:00:00`).toLocaleDateString("en-US", {
              weekday: "narrow",
            }),
          )}
          color={t.fit}
          label={`Steps, last 7 days: ${steps.map(n).join(", ")}`}
        />
      </View>
    </Frame>
  )
}
