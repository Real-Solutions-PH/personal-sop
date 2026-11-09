import { useLocalSearchParams } from "expo-router"
import { Templates } from "@/prototype/screens/fitness-templates"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  // Keyed: a copy opened from a built-in starts its editor afresh.
  return <Templates key={p.id} id={p.id} />
}
