import { useLocalSearchParams } from "expo-router"
import { Templates } from "@/prototype/screens/fitness-templates"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Templates id={p.id} />
}
