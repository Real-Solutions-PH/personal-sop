import { Suspense } from "react"
import { ExerciseDetailScreen } from "@/proto/fitness/screens/exercises"

export default function Page() {
  return (
    <Suspense>
      <ExerciseDetailScreen />
    </Suspense>
  )
}
