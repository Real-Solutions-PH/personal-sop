import { useLocalSearchParams } from "expo-router"
import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { NutritionHome } from "@/prototype/screens/nutrition-home"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return (
    <FirstOpenSetup module="nutrition" href="/nutrition">
      <NutritionHome day={p.day} range={p.range} />
    </FirstOpenSetup>
  )
}
