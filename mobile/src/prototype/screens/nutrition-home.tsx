// The Nutrition page (ADR-0024): the day's or the period's food against the
// targets, the day's meals, and calories by macro, with every nutrient
// opening its breakdown. Meals are kept in the fitness store; Nutrition is
// its own module in the app.
import { asPeriod } from "../nutrition-period"
import { Nutrition } from "./nutrition"

export function NutritionHome({
  day,
  range,
}: {
  day?: string
  range?: string
}) {
  return <Nutrition day={day} period={asPeriod(range)} />
}
