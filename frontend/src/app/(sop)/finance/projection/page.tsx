import { Suspense } from "react"
import { ProjectionScreen } from "@/proto/finance/screens/projection"

export default function Page() {
  return (
    <Suspense>
      <ProjectionScreen />
    </Suspense>
  )
}
