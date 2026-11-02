import { useLocalSearchParams } from "expo-router"
import { asPeriod, isNutrient } from "@/prototype/nutrition-period"
import { NutritionHome } from "@/prototype/screens/nutrition-home"
import { NutrientDetail } from "@/prototype/screens/nutrition-nutrient"

export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  // An unknown nutrient lands on the page it came from.
  if (!isNutrient(p.key)) return <NutritionHome day={p.day} />
  return (
    <NutrientDetail nutrient={p.key} day={p.day} period={asPeriod(p.range)} />
  )
}
