import { useLocalSearchParams } from "expo-router"
import { HabitDetail } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <HabitDetail id={p.id} />
}
