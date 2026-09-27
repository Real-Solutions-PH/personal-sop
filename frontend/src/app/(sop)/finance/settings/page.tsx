import { Suspense } from "react"
import { FinanceSettings } from "@/proto/finance/screens/settings"

export default function Page() {
  return (
    <Suspense>
      <FinanceSettings />
    </Suspense>
  )
}
