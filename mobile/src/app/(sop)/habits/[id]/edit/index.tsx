import { useLocalSearchParams } from "expo-router"
import { HabitForm } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <HabitForm id={p.id} />
}
