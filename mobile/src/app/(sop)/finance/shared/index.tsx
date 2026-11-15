import { useLocalSearchParams } from "expo-router"
import { SharedHome } from "@/prototype/screens/finance-shared"
export default function Page() {
  const p = useLocalSearchParams<{ new?: string }>()
  return <SharedHome startNew={p.new === "1"} />
}
