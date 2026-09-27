import { HabitsPlanView } from "@/proto/habits/plan"
import { Screen } from "@/proto/ui/kit"

// Standalone preview of the Plan › Habits segment (HAB-22).
export default function Page() {
  return (
    <Screen title="This week" back>
      <HabitsPlanView />
    </Screen>
  )
}
