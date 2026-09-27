import { Suspense } from "react"
import { HistoryScreen } from "@/proto/fitness/screens/workouts"

export default function Page() {
  return (
    <Suspense>
      <HistoryScreen />
    </Suspense>
  )
}
