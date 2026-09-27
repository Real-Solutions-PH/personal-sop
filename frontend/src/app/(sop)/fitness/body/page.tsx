import { Suspense } from "react"
import { BodyScreen } from "@/proto/fitness/screens/body"

export default function Page() {
  return (
    <Suspense>
      <BodyScreen />
    </Suspense>
  )
}
