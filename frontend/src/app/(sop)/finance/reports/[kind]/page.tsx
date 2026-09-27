import { Suspense } from "react"
import { ReportDetail } from "@/proto/finance/screens/reports"

export default function Page() {
  return (
    <Suspense>
      <ReportDetail />
    </Suspense>
  )
}
