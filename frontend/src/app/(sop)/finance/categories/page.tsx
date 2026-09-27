import { Suspense } from "react"
import { CategoriesScreen } from "@/proto/finance/screens/categories"

export default function Page() {
  return (
    <Suspense>
      <CategoriesScreen />
    </Suspense>
  )
}
