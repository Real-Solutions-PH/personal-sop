import { useLocalSearchParams } from "expo-router"
import { RoutineDetail } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RoutineDetail id={p.id} />
}
