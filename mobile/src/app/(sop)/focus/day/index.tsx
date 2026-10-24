import { useLocalSearchParams } from "expo-router"
import { FocusDay } from "@/prototype/screens/focus-day"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <FocusDay day={p.day} />
}
