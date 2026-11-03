// Today's goals as vines, in the brand kit's daily-review style: the stem
// grows toward the target, leaves come as it grows, and the bud at the end
// opens when the goal is hit. And the words under each goal and each miss:
// what is left, what was hit, what a miss cost.
import type { Miss } from "@domain/contract"
import type { Goal } from "@domain/dash/data"
import { useMemo } from "react"
import { View } from "react-native"
import Svg, { Path } from "react-native-svg"
import { jitter, leaf, rng, smooth } from "./brand/scribble"
import { useTheme } from "./theme"

const W = 270

export function GoalVine({
  pct,
  hit,
  color,
  seed,
}: {
  pct: number
  hit: boolean
  color: string
  seed: number
}) {
  const t = useTheme()
  const { stem, leaves } = useMemo(() => {
    const p = Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0)),
      w = Math.max(10, p * W)
    return {
      stem: smooth(
        jitter(
          [
            [8, 14],
            [8 + w * 0.33, 12.5],
            [8 + w * 0.66, 15],
            [8 + w, 13.5],
          ],
          1,
          rng(seed),
        ),
      ),
      leaves: [0.3, 0.55, 0.8]
        .filter((at) => at * W < w - 8)
        .map((at, k) => leaf(8 + at * W, 13.5, 10, k % 2 ? -0.95 : -2.2, 0.5))
        .join(" "),
    }
  }, [pct, seed])
  return (
    <View testID={hit ? "goal-vine-hit" : "goal-vine"}>
      <Svg width="100%" height={26} viewBox="0 0 300 26">
        <Path
          d="M8 14 H286"
          stroke={t.line}
          strokeWidth={1.5}
          strokeDasharray="1 5"
          strokeLinecap="round"
        />
        <Path
          d={stem}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
        />
        {leaves ? <Path d={leaves} fill={color} opacity={0.85} /> : null}
        {hit ? (
          // The bud open: two leaves spread from the end of the line.
          <Path
            testID="goal-bud-open"
            d={`${leaf(286, 14, 11, -1.2, 0.45)} ${leaf(286, 14, 9, -0.4, 0.45)}`}
            fill={t.good}
            stroke={t.good}
            strokeWidth={0.8}
          />
        ) : (
          <Path
            testID="goal-bud"
            d={leaf(286, 14, 10, -1.57, 0.44)}
            fill="none"
            stroke={t.muted}
            strokeWidth={1.3}
          />
        )}
      </Svg>
    </View>
  )
}

const n = (v: number) =>
  (Math.round(v * 10) / 10).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  })

/** The line under a goal: what is left, or that it is hit. Nothing while
 * the metric has no value yet. */
export function goalLeft(goal: Goal, current: number | null, hit: boolean) {
  if (current === null) return null
  const unit = goal.unit === "%" ? " pts" : goal.unit ? ` ${goal.unit}` : ""
  if (hit) return `Hit this ${goal.period}`
  return goal.comparator === "gte"
    ? `${n(goal.target - current)}${unit} to go this ${goal.period}`
    : `${n(current - goal.target)}${unit} over this ${goal.period}`
}

/** A miss as what slipped and what it cost: "Evening walk" and "missed ·
 * the 6-day run ended at 6". `endedRun` is the habit streak the miss ended
 * (0 when there was none to speak of). */
export function missCost(
  m: Pick<Miss, "title" | "module">,
  endedRun = 0,
): { name: string; cost: string } {
  const habit = /^Missed: (.+)$/.exec(m.title)
  if (habit)
    return {
      name: habit[1],
      cost: endedRun
        ? `missed · the ${endedRun.toLocaleString("en-US")}-day run ended at ${endedRun.toLocaleString("en-US")}`
        : "missed",
    }
  const tagged =
    /^(Overdue \d+d|Done \d+d late|Pushed \d+×|Unpaid|Stalled): (.+)$/.exec(
      m.title,
    )
  if (tagged) return { name: tagged[2], cost: tagged[1].toLowerCase() }
  return { name: m.title, cost: "missed" }
}
