import { prototypeMode } from "@/prototype/mode"
import { ForgotPassword } from "@/prototype/screens/auth-forgot"

// Route discovery evaluates every route, including inactive protected screens.
// Keep connected-only native dependencies behind the mode check.
export default function Page() {
  if (prototypeMode) return <ForgotPassword />
  const Screen = require("@/connected/recover-password").default
  return <Screen />
}
