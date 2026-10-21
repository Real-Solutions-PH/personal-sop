import { useLocalSearchParams } from "expo-router"
import { Exercises } from "@/prototype/screens/fitness-exercises"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Exercises id={p.id} />
}
