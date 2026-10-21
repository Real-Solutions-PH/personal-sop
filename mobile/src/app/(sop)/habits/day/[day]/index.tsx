import { useLocalSearchParams } from "expo-router"
import { HabitDay } from "@/prototype/screens/habit-secondary"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <HabitDay day={p.day} />
}
