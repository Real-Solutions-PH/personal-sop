import { Suspense } from "react"
import { TargetsScreen } from "@/proto/fitness/screens/nutrition"

export default function Page() {
  return (
    <Suspense>
      <TargetsScreen />
    </Suspense>
  )
}
