import { useLocalSearchParams } from "expo-router"
import { Accounts } from "@/prototype/screens/finance-accounts"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Accounts id={p.id} />
}
