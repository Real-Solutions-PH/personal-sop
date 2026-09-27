import { Suspense } from "react"
import { JournalListScreen } from "@/proto/capture/screens/journal"

export default function Page() {
  return (
    <Suspense>
      <JournalListScreen />
    </Suspense>
  )
}
