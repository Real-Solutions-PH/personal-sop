import { Suspense } from "react"
import { BudgetsScreen } from "@/proto/finance/screens/budgets"

export default function Page() {
  return (
    <Suspense>
      <BudgetsScreen />
    </Suspense>
  )
}
