import { useLocalSearchParams } from "expo-router"
import { CaptureThread } from "@/prototype/screens/capture"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <CaptureThread id={p.id} />
}
