import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"
import { Welcome } from "@/prototype/screens/auth-welcome"

// Prototype-only first screen; the connected template starts at /login.
export default function Page() {
  return prototypeMode ? <Welcome /> : <Redirect href="/login" />
}
