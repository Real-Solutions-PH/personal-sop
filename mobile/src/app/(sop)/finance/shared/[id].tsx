import { useLocalSearchParams } from "expo-router"
import { LoanDetail } from "@/prototype/screens/finance-shared"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <LoanDetail loanId={p.id} />
}
