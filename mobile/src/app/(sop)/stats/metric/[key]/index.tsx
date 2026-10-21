import { useLocalSearchParams } from "expo-router"
import { MetricDetail } from "@/prototype/screens/dash-metric"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <MetricDetail metric={p.key} />
}
