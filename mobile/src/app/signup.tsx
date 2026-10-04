import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"

// Route discovery evaluates every route, including inactive protected screens.
// Keep connected-only native dependencies behind the mode check.
export default function Page() {
  if (prototypeMode) return <Redirect href="/today" />
  const Screen = require("@/connected/signup").default
  return <Screen />
}
