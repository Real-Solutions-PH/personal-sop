import { useLocalSearchParams } from "expo-router"
import { BudgetDetail } from "@/prototype/screens/finance-shared-groups"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <BudgetDetail budgetId={p.id} />
}
