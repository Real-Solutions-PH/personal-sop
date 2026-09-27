import { Suspense } from "react"
import { ThreadScreen } from "@/proto/capture/screens/thread"

export default function Page() {
  return (
    <Suspense>
      <ThreadScreen />
    </Suspense>
  )
}
