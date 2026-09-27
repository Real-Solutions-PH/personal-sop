import { Suspense } from "react"
import { TemplateEditorScreen } from "@/proto/fitness/screens/templates"

export default function Page() {
  return (
    <Suspense>
      <TemplateEditorScreen />
    </Suspense>
  )
}
