import { useLocalSearchParams } from "expo-router"
import { TaskDetail } from "@/prototype/screens/task-detail"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <TaskDetail id={p.id} />
}
