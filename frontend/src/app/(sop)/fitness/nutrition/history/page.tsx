import { Suspense } from "react"
import { NutritionHistoryScreen } from "@/proto/fitness/screens/nutrition"

export default function Page() {
  return (
    <Suspense>
      <NutritionHistoryScreen />
    </Suspense>
  )
}
