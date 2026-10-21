import { useLocalSearchParams } from "expo-router"
import { Nutrition } from "@/prototype/screens/fitness-nutrition"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Nutrition day={p.day} />
}
