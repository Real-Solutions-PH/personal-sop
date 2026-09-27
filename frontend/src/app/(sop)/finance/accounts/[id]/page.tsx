import { Suspense } from "react"
import { AccountDetail } from "@/proto/finance/screens/accounts"

export default function Page() {
  return (
    <Suspense>
      <AccountDetail />
    </Suspense>
  )
}
