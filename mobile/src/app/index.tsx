import { Redirect } from "expo-router"
import { useAuthStore } from "@/stores/auth-store"

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  return <Redirect href={isAuthenticated ? "/(app)" : "/login"} />
}
