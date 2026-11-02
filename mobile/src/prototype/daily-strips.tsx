// Two strips at the top of Today. Yesterday's recap says plainly what a
// missed day cost (off target, the streak it ended, how many things were
// missed) and leads to the Misses page; it shows on the day after and goes
// once dismissed. The first-week strip keeps the promise onboarding makes
// ("log one thing today to light up day 1"): days 1–7 from the first log,
// lit as they are logged, until the first week is over.
import * as D from "@domain/dash/hooks"
import { addDays } from "@domain/habits/logic"
import { dayKey } from "@domain/lib/day"
import { ChevronRight, TrendingDown, X } from "lucide-react-native"
import { View } from "react-native"
import { alpha } from "./motion"
import { Copy, Frame, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { claimDay, firstWeek, rewardStore, yesterdayRecap } from "./rewards"
import { useTheme } from "./theme"

export function YesterdayStrip() {
  const today = dayKey()
  const yesterday = addDays(today, -1)
  const series = D.useOnTarget(7).series
  const missed = D.useAllMisses(yesterday, yesterday).length
  const dismissed = rewardStore.use((s) => s.days["yesterday-strip"] === today)
  const recap = yesterdayRecap(series, today)
  if (dismissed || (!recap.offTarget && !missed)) return null
  const headline = recap.offTarget
    ? `Yesterday: off target${recap.ended > 1 ? ` · ${recap.ended}-day streak ended` : ""}`
    : `Yesterday: ${missed} missed`
  const detail = recap.offTarget
    ? missed
      ? `${missed} missed · see what slipped`
      : "See what slipped"
    : "On target, but these slipped"
  return (
    <YesterdayStripView
      headline={headline}
      detail={detail}
      onDismiss={() => claimDay("yesterday-strip", today)}
    />
  )
}

export function YesterdayStripView({
  headline,
  detail,
  onDismiss,
}: {
  headline: string
  detail: string
  onDismiss: () => void
}) {
  const t = useTheme()
  return (
    <View testID="yesterday-strip">
      <Frame style={{ flexDirection: "row" }}>
        <Tap
          label={`${headline}. ${detail}`}
          onPress={() => go("/stats/misses")}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 12,
            paddingLeft: 16,
          }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: alpha(t.bad, 0.12),
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <TrendingDown size={18} color={t.bad} />
          </View>
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="semibold" style={{ color: t.bad }}>
              {headline}
            </Copy>
            <Copy size={12} muted>
              {detail}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Tap>
        <Tap
          label="Dismiss"
          onPress={onDismiss}
          style={{ width: 44, alignItems: "center", justifyContent: "center" }}
        >
          <X size={16} color={t.muted} />
        </Tap>
      </Frame>
    </View>
  )
}

export function FirstWeekStrip() {
  const today = dayKey()
  const series = D.useOnTarget(7).series
  const week = firstWeek(
    series.filter((d) => d.done > 0).map((d) => d.day),
    today,
  )
  return <FirstWeekView week={week} today={today} />
}

export function FirstWeekView({
  week,
  today,
}: {
  week: { day: string; logged: boolean }[]
  today: string
}) {
  const t = useTheme()
  if (!week.length) return null
  const n = week.findIndex((d) => d.day === today) + 1
  const lit = week.filter((d) => d.logged).length
  const todayLit = week[n - 1]?.logged
  return (
    <View testID="first-week">
      <Frame style={{ padding: 16 }}>
        <Line style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <Copy size={14} weight="semibold">
            Your first week
          </Copy>
          <Copy size={12} muted>
            Day {n} of 7 · {lit} lit
          </Copy>
        </Line>
        <Line style={{ gap: 6 }}>
          {week.map((d, i) => (
            <View
              key={d.day}
              accessibilityLabel={`Day ${i + 1}${d.logged ? ", lit" : ""}`}
              style={{
                height: 8,
                flex: 1,
                borderRadius: 4,
                backgroundColor: d.logged ? t.primary : t.soft,
                borderWidth: d.day === today && !d.logged ? 1 : 0,
                borderColor: t.primary,
              }}
            />
          ))}
        </Line>
        <Copy size={12} muted style={{ marginTop: 8 }}>
          {todayLit
            ? n < 7
              ? `Day ${n} is lit. Come back tomorrow for day ${n + 1}.`
              : "Your first week is complete."
            : `Log one thing today to light up day ${n}.`}
        </Copy>
      </Frame>
    </View>
  )
}
