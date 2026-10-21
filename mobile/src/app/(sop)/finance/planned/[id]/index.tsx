import { useLocalSearchParams } from "expo-router"
import { Planned } from "@/prototype/screens/finance-planned"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Planned id={p.id} />
}
