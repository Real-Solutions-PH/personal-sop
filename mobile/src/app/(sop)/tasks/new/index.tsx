import { useLocalSearchParams } from "expo-router"
import { TaskNew } from "@/prototype/screens/task-new"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <TaskNew listId={p.list} day={p.day} />
}
