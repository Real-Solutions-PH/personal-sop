import { Suspense } from "react"
import { ShareScreen } from "@/proto/fitness/screens/share"

export default function Page() {
  return (
    <Suspense>
      <ShareScreen />
    </Suspense>
  )
}
