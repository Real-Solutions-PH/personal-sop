import { useLocalSearchParams } from "expo-router"
import { MealDetail } from "@/prototype/screens/fitness-meals"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <MealDetail id={p.id} />
}
