import { useLocalSearchParams } from "expo-router"
import { Reviews } from "@/prototype/screens/dashboard"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Reviews id={p.id} />
}
