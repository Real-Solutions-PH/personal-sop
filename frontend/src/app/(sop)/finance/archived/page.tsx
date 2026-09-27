import { Suspense } from "react"
import { ArchivedScreen } from "@/proto/finance/screens/settings"

export default function Page() {
  return (
    <Suspense>
      <ArchivedScreen />
    </Suspense>
  )
}
