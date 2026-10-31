import { useLocalSearchParams } from "expo-router"
import { FoodDetail } from "@/prototype/screens/nutrition-food-detail"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <FoodDetail id={p.id} />
}
