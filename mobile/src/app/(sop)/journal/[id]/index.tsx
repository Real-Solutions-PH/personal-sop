import { useLocalSearchParams } from "expo-router"
import { Journal } from "@/prototype/screens/capture"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Journal id={p.id} />
}
