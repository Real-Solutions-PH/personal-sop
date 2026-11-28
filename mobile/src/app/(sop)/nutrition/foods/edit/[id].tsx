import { useLocalSearchParams } from "expo-router"
import { FoodEdit } from "@/prototype/screens/nutrition-food-edit"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <FoodEdit id={p.id} />
}
