import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { TasksHome } from "@/prototype/screens/plan"
export default function Page() {
  return (
    <FirstOpenSetup module="tasks" href="/tasks">
      <TasksHome />
    </FirstOpenSetup>
  )
}
