import { Suspense } from "react"
import { PlannedDetail } from "@/proto/finance/screens/planned"

export default function Page() {
  return (
    <Suspense>
      <PlannedDetail />
    </Suspense>
  )
}
