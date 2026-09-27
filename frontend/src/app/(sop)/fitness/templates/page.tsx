import { Suspense } from "react"
import { TemplatesScreen } from "@/proto/fitness/screens/templates"

export default function Page() {
  return (
    <Suspense>
      <TemplatesScreen />
    </Suspense>
  )
}
