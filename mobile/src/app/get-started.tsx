import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"
import { Onboarding } from "@/prototype/screens/onboarding"

// Onboarding before the account exists; its last step creates the account.
// Prototype only, like the Welcome screen that opens it.
export default function Page() {
  return prototypeMode ? <Onboarding phase="pre" /> : <Redirect href="/login" />
}
