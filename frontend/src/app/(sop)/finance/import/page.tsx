import { Suspense } from "react"
import { ImportStart } from "@/proto/finance/screens/import"

export default function Page() {
  return (
    <Suspense>
      <ImportStart />
    </Suspense>
  )
}
