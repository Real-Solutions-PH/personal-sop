import { Suspense } from "react"
import { SummaryScreen } from "@/proto/fitness/screens/workouts"

export default function Page() {
  return (
    <Suspense>
      <SummaryScreen />
    </Suspense>
  )
}
