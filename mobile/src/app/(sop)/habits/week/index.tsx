import { HabitPlanPanel } from "@/prototype/screens/plan"
import { Screen } from "@/prototype/ui"
export default function Page() {
  return (
    <Screen prototypeLayout title="This week">
      <HabitPlanPanel />
    </Screen>
  )
}
