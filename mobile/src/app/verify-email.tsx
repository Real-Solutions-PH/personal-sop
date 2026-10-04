import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"
import { VerifyEmail } from "@/prototype/screens/auth-verify"

// Prototype-only sign-up step; the connected template starts at /login.
export default function Page() {
  return prototypeMode ? <VerifyEmail /> : <Redirect href="/login" />
}
