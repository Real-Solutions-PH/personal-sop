import { useLocalSearchParams } from "expo-router"
import { TaskListPage } from "@/prototype/screens/task-lists"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <TaskListPage id={p.id} />
}
