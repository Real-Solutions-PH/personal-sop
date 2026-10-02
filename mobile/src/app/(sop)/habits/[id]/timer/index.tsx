import { useLocalSearchParams } from "expo-router"
import { HabitTimer } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <HabitTimer id={p.id} />
}
