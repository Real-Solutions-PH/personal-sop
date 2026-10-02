import { useLocalSearchParams } from "expo-router"
import { TaskCapture } from "@/prototype/screens/tasks"
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <TaskCapture listId={p.list} day={p.day} />
}
