import { Suspense } from "react"
import { NutritionDayScreen } from "@/proto/fitness/screens/nutrition"

export default function Page() {
  return (
    <Suspense>
      <NutritionDayScreen />
    </Suspense>
  )
}
