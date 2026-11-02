// Goals whose last week or month ended unmet, in the bad colour: the cost
// of a period that closed short, said once it is over rather than left to
// vanish as the rolling figure moves on. Shown on Goals and on Misses.
import type { Goal } from "@domain/dash/data"
import { fmtGoal } from "@domain/dash/hooks"
import { dayKey } from "@domain/lib/day"
import { CircleX } from "lucide-react-native"
import { View } from "react-native"
import { goalLedger, missedGoals, periodLabel } from "./goal-ledger"
import { alpha } from "./motion"
import { Copy, Tap } from "./native-kit"
import { go } from "./navigation"
import { useTheme } from "./theme"

export function MissedGoals({
  goals,
  link = false,
}: {
  goals: readonly Goal[]
  /** Rows open the Goals page (from Misses). */
  link?: boolean
}) {
  const t = useTheme()
  const notes = goalLedger.use((s) => s.notes)
  const missed = missedGoals(notes, goals, dayKey())
  if (!missed.length) return null
  return (
    <View
      testID="missed-goals"
      style={{
        borderRadius: 14,
        padding: 12,
        gap: 8,
        backgroundColor: alpha(t.bad, 0.1),
      }}
    >
      {missed.map((m) => {
        const row = (
          <View key={m.goal.id} style={{ flexDirection: "row", gap: 8 }}>
            <CircleX size={16} color={t.bad} style={{ marginTop: 2 }} />
            <View style={{ flex: 1 }}>
              <Copy size={14} weight="medium" style={{ color: t.bad }}>
                Missed {periodLabel(m.period, m.goal.period)}: {m.goal.label}{" "}
                {fmtGoal(m.goal)}
              </Copy>
              <Copy size={12} muted>
                Ended at {m.value}
              </Copy>
            </View>
          </View>
        )
        return link ? (
          <Tap
            key={m.goal.id}
            label={`Missed ${m.goal.label}. Open goals`}
            onPress={() => go("/stats/goals")}
          >
            {row}
          </Tap>
        ) : (
          row
        )
      })}
    </View>
  )
}
