import { Suspense } from "react"
import { PlannedScreen } from "@/proto/finance/screens/planned"

export default function Page() {
  return (
    <Suspense>
      <PlannedScreen />
    </Suspense>
  )
}
