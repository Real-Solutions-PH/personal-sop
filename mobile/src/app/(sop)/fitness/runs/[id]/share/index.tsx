import { useLocalSearchParams } from "expo-router"
import { RunShare } from "@/prototype/screens/run-share"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <RunShare id={p.id} />
}
