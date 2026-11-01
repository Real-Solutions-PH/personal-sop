import { useLocalSearchParams } from "expo-router"
import { RunDetail } from "@/prototype/screens/fitness-runs"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RunDetail id={p.id} summary={p.summary === "1"} />
}
