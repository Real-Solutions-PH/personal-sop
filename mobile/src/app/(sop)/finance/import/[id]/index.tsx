import { useLocalSearchParams } from "expo-router"
import { ImportStatement } from "@/prototype/screens/finance-import"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <ImportStatement id={p.id} />
}
