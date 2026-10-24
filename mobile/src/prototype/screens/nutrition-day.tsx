import * as C from "@domain/fitness/calc"
import { dayDetail, fiberGoalFor, limitsFor } from "@domain/fitness/limits"
import { fitStore } from "@domain/fitness/store"
import { View } from "react-native"
import { Copy } from "../native-kit"
import { LimitList } from "./nutrient-limits"
import { MacroRings } from "./nutrition"

/** One day's food against the target: rings for the goals (calories,
 * protein, carbs, fat), a line with the totals, and the "Stay under" bars
 * for the limits. The Today card and Fern's nutrition card both draw it. */
export function NutritionDay({ day }: { day: string }) {
  const s = fitStore.use((s) => s)
  const totals = C.dayTotals(s, day)
  const target = C.targetFor(s, day)
  const detail = dayDetail(C.mealsOn(s, day))
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 12 }}>
        <MacroRings totals={totals.totals} target={target} />
        <Copy size={12} muted>
          {[
            target
              ? `${Math.round(totals.totals.kcal).toLocaleString("en-US")} / ${target.kcal.toLocaleString("en-US")} kcal · P ${Math.round(totals.totals.protein)}/${target.protein} g`
              : "No targets yet — showing what you ate",
            detail.fiber !== undefined &&
              `Fiber ${Math.round(detail.fiber)}/${fiberGoalFor(target)} g`,
            totals.pending && `+${totals.pending} pending`,
            totals.toReview && `${totals.toReview} to review`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Copy>
      </View>
      <LimitList detail={detail} limits={limitsFor(target)} />
    </View>
  )
}
