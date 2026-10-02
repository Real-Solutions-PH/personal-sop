import { useLocalSearchParams } from "expo-router"
import { RoutineSummary } from "@/prototype/screens/routines"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RoutineSummary id={p.id} runId={p.run} />
}
