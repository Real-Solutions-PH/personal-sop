import { Suspense } from "react"
import { ManualMealScreen } from "@/proto/fitness/screens/nutrition"

export default function Page() {
  return (
    <Suspense>
      <ManualMealScreen />
    </Suspense>
  )
}
