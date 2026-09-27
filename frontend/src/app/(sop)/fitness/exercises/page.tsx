import { Suspense } from "react"
import { LibraryScreen } from "@/proto/fitness/screens/exercises"

export default function Page() {
  return (
    <Suspense>
      <LibraryScreen />
    </Suspense>
  )
}
