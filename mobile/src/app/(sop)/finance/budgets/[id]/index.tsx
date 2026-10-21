import { useLocalSearchParams } from "expo-router"
import { Budgets } from "@/prototype/screens/finance-budgets"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Budgets id={p.id} />
}
