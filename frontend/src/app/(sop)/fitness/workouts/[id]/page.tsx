import { Suspense } from "react"
import { WorkoutDetailScreen } from "@/proto/fitness/screens/workouts"

export default function Page() {
  return (
    <Suspense>
      <WorkoutDetailScreen />
    </Suspense>
  )
}
