import { Suspense } from "react"
import { HistoryScreen } from "@/proto/capture/screens/history"

export default function Page() {
  return (
    <Suspense>
      <HistoryScreen />
    </Suspense>
  )
}
