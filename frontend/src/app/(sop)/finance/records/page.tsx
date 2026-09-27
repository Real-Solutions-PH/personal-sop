import { Suspense } from "react"
import { RecordsScreen } from "@/proto/finance/screens/records"

export default function Page() {
  return (
    <Suspense>
      <RecordsScreen />
    </Suspense>
  )
}
