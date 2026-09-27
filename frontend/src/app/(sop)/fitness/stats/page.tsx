import { Suspense } from "react"
import { StatsScreen } from "@/proto/fitness/screens/stats"

export default function Page() {
  return (
    <Suspense>
      <StatsScreen />
    </Suspense>
  )
}
