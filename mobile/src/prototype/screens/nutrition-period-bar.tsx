// The Nutrition page's one filter, shared by the page and every nutrient's
// breakdown: a day, or the 7 or 30 days ending on it, with arrows that move
// the day. Everything under it reads from this.
import * as C from "@domain/fitness/calc"
import { dayKey } from "@domain/lib/day"
import { ChevronLeft, ChevronRight } from "lucide-react-native"
import { View } from "react-native"
import { border, Copy, IconTap, Line, Segmented } from "../native-kit"
import { daysEnding, PERIODS, type Period } from "../nutrition-period"
import { useTheme } from "../theme"

const short = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  })

export function PeriodBar({
  day,
  period,
  onDay,
  onPeriod,
}: {
  day: string
  period: Period
  onDay: (day: string) => void
  onPeriod: (p: Period) => void
}) {
  const t = useTheme(),
    today = dayKey(),
    n = Number(period),
    first = daysEnding(day, n)[0]
  return (
    <View style={{ gap: 8 }}>
      <Segmented value={period} onChange={onPeriod} options={PERIODS} />
      <Line style={{ justifyContent: "space-between" }}>
        <IconTap
          size={40}
          icon={ChevronLeft}
          label="Previous day"
          onPress={() => onDay(C.addDays(day, -1))}
        />
        <View style={{ alignItems: "center", flexShrink: 1 }}>
          <Copy weight="semibold" style={{ textAlign: "center" }}>
            {n === 1
              ? day === today
                ? "Today"
                : C.relDay(`${day}T12:00:00`)
              : day === today
                ? `Last ${n} days`
                : `${n} days to ${short(day)}`}
          </Copy>
          <Copy size={12} muted style={{ textAlign: "center" }}>
            {n === 1 ? C.fmtDay(day) : `${short(first)} – ${short(day)}`}
          </Copy>
        </View>
        <IconTap
          size={40}
          icon={ChevronRight}
          label="Next day"
          color={day >= today ? border(t.muted, 0.3) : t.muted}
          onPress={() => {
            if (day < today) onDay(C.addDays(day, 1))
          }}
        />
      </Line>
    </View>
  )
}
