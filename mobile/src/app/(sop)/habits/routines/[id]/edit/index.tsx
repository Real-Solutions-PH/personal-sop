import { useLocalSearchParams } from "expo-router"
import { RoutineForm } from "@/prototype/screens/habits"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RoutineForm id={p.id} />
}
