import { prototypeMode } from "@/prototype/mode"
import { ResetPassword } from "@/prototype/screens/auth-reset"

// Route discovery evaluates every route, including inactive protected screens.
// Keep connected-only native dependencies behind the mode check.
export default function Page() {
  if (prototypeMode) return <ResetPassword />
  const Screen = require("@/connected/reset-password").default
  return <Screen />
}
