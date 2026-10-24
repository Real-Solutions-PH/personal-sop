import { useLocalSearchParams } from "expo-router"
import { NutritionHome } from "@/prototype/screens/nutrition-home"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <NutritionHome day={p.day} />
}
