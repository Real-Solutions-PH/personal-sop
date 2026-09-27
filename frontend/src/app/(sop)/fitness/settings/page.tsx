import { Suspense } from "react"
import { SettingsScreen } from "@/proto/fitness/screens/settings"

export default function Page() {
  return (
    <Suspense>
      <SettingsScreen />
    </Suspense>
  )
}
