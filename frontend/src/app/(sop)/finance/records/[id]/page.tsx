import { Suspense } from "react"
import { RecordDetail } from "@/proto/finance/screens/record-detail"

export default function Page() {
  return (
    <Suspense>
      <RecordDetail />
    </Suspense>
  )
}
