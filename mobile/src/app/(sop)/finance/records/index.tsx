import { useLocalSearchParams } from "expo-router"
import { Records } from "@/prototype/screens/finance-records"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Records accountId={p.account} />
}
