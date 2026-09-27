import { Suspense } from "react"
import { MealScreen } from "@/proto/fitness/screens/nutrition"

export default function Page() {
  return (
    <Suspense>
      <MealScreen />
    </Suspense>
  )
}
