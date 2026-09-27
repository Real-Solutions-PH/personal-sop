import { Suspense } from "react"
import { FinanceHome } from "@/proto/finance/screens/home"

export default function Page() {
  return (
    <Suspense>
      <FinanceHome />
    </Suspense>
  )
}
