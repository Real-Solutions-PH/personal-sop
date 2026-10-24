// The Nutrition page (ADR-0024): the day's meals against the targets, then
// the statistics, meal history, food library and targets. Meals are kept in
// the fitness store; Nutrition is its own module in the app.
import { Nutrition } from "./nutrition"
import { NutritionStats } from "./nutrition-stats"

export function NutritionHome({ day }: { day?: string }) {
  return (
    <Nutrition day={day}>
      <NutritionStats />
    </Nutrition>
  )
}
