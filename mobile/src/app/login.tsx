import { prototypeMode } from "@/prototype/mode"
import { SignIn } from "@/prototype/screens/auth-sign-in"

// Route discovery evaluates every route, including inactive protected screens.
// Keep connected-only native dependencies behind the mode check.
export default function Page() {
  if (prototypeMode) return <SignIn />
  const Screen = require("@/connected/login").default
  return <Screen />
}
