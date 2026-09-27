import { Suspense } from "react"
import { LoggerScreen } from "@/proto/fitness/screens/logger"

export default function Page() {
  return (
    <Suspense>
      <LoggerScreen />
    </Suspense>
  )
}
