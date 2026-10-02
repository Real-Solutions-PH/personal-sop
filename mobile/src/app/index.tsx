import { Redirect } from "expo-router"
import { prototypeMode } from "@/prototype/mode"

function ConnectedIndex() {
  const { useAuthStore } =
    require("@/stores/auth-store") as typeof import("@/stores/auth-store")
  const authenticated = useAuthStore((s) => s.isAuthenticated)
  return <Redirect href={authenticated ? "/(app)" : "/login"} />
}
export default function Index() {
  return prototypeMode ? <Redirect href="/today" /> : <ConnectedIndex />
}
