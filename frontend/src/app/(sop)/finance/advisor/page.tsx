import { Suspense } from "react"
import { AdvisorScreen } from "@/proto/finance/screens/advisor"

export default function Page() {
  return (
    <Suspense>
      <AdvisorScreen />
    </Suspense>
  )
}
