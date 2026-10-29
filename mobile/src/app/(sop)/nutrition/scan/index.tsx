import { useLocalSearchParams } from "expo-router"
import { FoodScan } from "@/prototype/screens/food-scan"
export default function Page() {
  const p = useLocalSearchParams<{ day?: string }>()
  return <FoodScan day={p.day} />
}
