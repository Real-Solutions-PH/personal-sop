import { useLocalSearchParams } from "expo-router"
import { WorkoutDetail } from "@/prototype/screens/fitness-workouts"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <WorkoutDetail id={p.id} />
}
