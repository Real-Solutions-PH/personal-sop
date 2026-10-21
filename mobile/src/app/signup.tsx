import { prototypeMode } from "@/prototype/mode"
import { SignUp } from "@/prototype/screens/auth-sign-up"

// Route discovery evaluates every route, including inactive protected screens.
// Keep connected-only native dependencies behind the mode check.
export default function Page() {
  if (prototypeMode) return <SignUp />
  const Screen = require("@/connected/signup").default
  return <Screen />
}
