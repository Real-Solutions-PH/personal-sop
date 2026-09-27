import { Suspense } from "react"
import { ImportHistory } from "@/proto/finance/screens/import"

export default function Page() {
  return (
    <Suspense>
      <ImportHistory />
    </Suspense>
  )
}
