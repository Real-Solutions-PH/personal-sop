import { Suspense } from "react"
import { BudgetDetail } from "@/proto/finance/screens/budgets"

export default function Page() {
  return (
    <Suspense>
      <BudgetDetail />
    </Suspense>
  )
}
