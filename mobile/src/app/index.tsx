import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"
import { sessionStore } from "@/prototype/session"

function ConnectedIndex() {
  const { useAuthStore } =
    require("@/stores/auth-store") as typeof import("@/stores/auth-store")
  const authenticated = useAuthStore((s) => s.isAuthenticated)
  return <Redirect href={authenticated ? "/(app)" : "/login"} />
}
function PrototypeIndex() {
  const signedIn = sessionStore.use((s) => s.signedIn)
  return <Redirect href={signedIn ? "/today" : "/welcome"} />
}
export default function Index() {
  return prototypeMode ? <PrototypeIndex /> : <ConnectedIndex />
}
