import { Suspense } from "react"
import { AccountsScreen } from "@/proto/finance/screens/accounts"

export default function Page() {
  return (
    <Suspense>
      <AccountsScreen />
    </Suspense>
  )
}
