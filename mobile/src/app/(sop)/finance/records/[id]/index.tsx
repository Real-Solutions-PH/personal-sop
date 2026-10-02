import { useLocalSearchParams } from "expo-router"
import { RecordDetail } from "@/prototype/screens/finance-records"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <RecordDetail id={p.id} />
}
