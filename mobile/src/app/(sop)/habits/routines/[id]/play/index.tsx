import { useLocalSearchParams } from "expo-router"
import { RoutinePlayer } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RoutinePlayer id={p.id} />
}
