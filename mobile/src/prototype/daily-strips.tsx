// Two strips at the top of Today. Yesterday's recap says plainly what a
// missed day cost (off target, the streak it ended, how many things were
// missed), with Fern consoling beside it, and leads to the Yesterday page
// (Fern's read of the day, then each miss); it
// shows on the day after and goes once dismissed. The first-week strip keeps the promise onboarding makes
// ("log one thing today to light up day 1"): days 1–7 from the first log,
// lit as they are logged, until the first week is over.
import * as D from "@domain/dash/hooks"
import { addDays } from "@domain/habits/logic"
import { dayKey } from "@domain/lib/day"
import { ChevronRight, X } from "lucide-react-native"
import { View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { CornerMotif } from "./brand/corner"
import { jitter, leaf, rng, smooth } from "./brand/scribble"
import { FernSprite } from "./companion/fern-sprite"
import { Copy, Frame, Line, Tap } from "./native-kit"
import { go } from "./navigation"
import { claimDay, firstWeek, rewardStore, yesterdayRecap } from "./rewards"
import { useTheme } from "./theme"
import { missesOn } from "./yesterday"

export function YesterdayStrip() {
  const today = dayKey()
  const yesterday = addDays(today, -1)
  const series = D.useOnTarget(7).series
  const missed = missesOn(
    D.useAllMisses(yesterday, yesterday),
    yesterday,
  ).length
  const dismissed = rewardStore.use((s) => s.days["yesterday-strip"] === today)
  const recap = yesterdayRecap(series, today)
  if (dismissed || (!recap.offTarget && !missed)) return null
  const headline = !recap.offTarget
    ? `Yesterday: ${missed} missed`
    : recap.grace
      ? "Yesterday: off target · grace day used"
      : `Yesterday: off target${recap.ended > 1 ? ` · run of ${recap.ended} ended` : ""}`
  // Fern's line: the cost first, then the way back.
  const lost = missed ? `${missed} missed. ` : ""
  const detail = !recap.offTarget
    ? "On target, but these slipped. Today is a new count."
    : recap.grace
      ? `${lost}The grace day kept your run going; hit today to keep it.`
      : recap.ended > 1
      ? `${lost}The ${recap.ended} days still count; the next one starts today.`
      : `${lost || "Missed yesterday. "}Today is a new count.`
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
          label={`${headline}. ${detail} See what slipped`}
          onPress={() => go("/today/yesterday")}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            paddingVertical: 12,
            paddingLeft: 16,
          }}
        >
          <FernSprite size={40} state="consoling" decorative />
          <View style={{ flex: 1 }}>
            <Copy size={14} weight="semibold" style={{ color: t.bad }}>
              {headline}
            </Copy>
            <Copy size={12} muted>
              {detail}{" "}
              <Copy size={12} weight="medium" style={{ color: t.primary }}>
                See what slipped
              </Copy>
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
        <CornerMotif kind="vine" seed={n + 2} />
        <Line style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <Copy size={14} weight="semibold">
            Your first week
          </Copy>
          <Copy size={12} muted>
            Day {n} of 7 · {lit} lit
          </Copy>
        </Line>
        <LeafRow
          cells={week.map((d) =>
            d.logged ? "lit" : d.day === today ? "today" : "ahead",
          )}
        />
        <Copy
          size={12}
          weight={todayLit && n === 7 ? "medium" : undefined}
          muted={!(todayLit && n === 7)}
          style={{
            marginTop: 8,
            color: todayLit && n === 7 ? t.good : undefined,
          }}
        >
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

export type LeafCell = "lit" | "today" | "ahead"
/** A day sequence as leaves on a stem, the share cards' calendar: filled
 * for a lit day, outlined in primary for today, faint for days ahead. */
export function LeafRow({ cells }: { cells: LeafCell[] }) {
  const t = useTheme()
  const lit = cells.filter((c) => c === "lit").length
  const cw = 300 / cells.length
  const stem = smooth(
    jitter(
      Array.from({ length: 8 }, (_, i) => [
        (i * 300) / 7,
        26 + Math.sin(i) * 1.5,
      ]) as [number, number][],
      1,
      rng(4),
    ),
  )
  return (
    <View
      testID="leaf-row"
      accessible
      accessibilityLabel={`${lit} of ${cells.length} days lit`}
    >
      <Svg
        width="100%"
        height={30}
        viewBox="0 0 300 30"
        preserveAspectRatio="xMidYMid meet"
      >
        <Path
          d={stem}
          fill="none"
          stroke={t.line}
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        {cells.map((c, i) => {
          const d = leaf(cw * i + cw / 2 - 6, 22, 18, -0.8, 0.46)
          return (
            <Path
              key={i}
              testID={`leaf-${c}`}
              d={d}
              fill={c === "lit" ? t.primary : "none"}
              stroke={c === "ahead" ? t.muted : t.primary}
              strokeWidth={c === "today" ? 1.6 : 1}
              opacity={c === "ahead" ? 0.45 : 1}
            />
          )
        })}
      </Svg>
    </View>
  )
}
