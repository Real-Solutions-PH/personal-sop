import { Suspense } from "react"
import { ReviewScreen } from "@/proto/finance/screens/review"

export default function Page() {
  return (
    <Suspense>
      <ReviewScreen />
    </Suspense>
  )
}
