import { Suspense } from "react"
import { ImportRun } from "@/proto/finance/screens/import"

export default function Page() {
  return (
    <Suspense>
      <ImportRun />
    </Suspense>
  )
}
