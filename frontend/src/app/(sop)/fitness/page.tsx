import { Suspense } from "react"
import { HubScreen } from "@/proto/fitness/screens/hub"

export default function Page() {
  return (
    <Suspense>
      <HubScreen />
    </Suspense>
  )
}
