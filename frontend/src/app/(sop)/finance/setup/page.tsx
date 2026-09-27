import { Suspense } from "react"
import { FinanceSetup } from "@/proto/finance/screens/settings"

export default function Page() {
  return (
    <Suspense>
      <FinanceSetup />
    </Suspense>
  )
}
