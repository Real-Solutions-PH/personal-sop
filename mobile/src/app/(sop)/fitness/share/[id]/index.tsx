import { useLocalSearchParams } from "expo-router"
import { FitnessShare } from "@/prototype/screens/fitness-share"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <FitnessShare id={p.id} />
}
