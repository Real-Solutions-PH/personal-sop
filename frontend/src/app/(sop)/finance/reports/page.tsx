import { Suspense } from "react"
import { ReportsHub } from "@/proto/finance/screens/reports"

export default function Page() {
  return (
    <Suspense>
      <ReportsHub />
    </Suspense>
  )
}
