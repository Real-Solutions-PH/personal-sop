import { useLocalSearchParams } from "expo-router"
import { Reports } from "@/prototype/screens/finance-reports"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Reports kind={p.kind} />
}
