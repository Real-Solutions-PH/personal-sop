import { HabitsTodayCard } from "@/proto/habits/today"
import { Screen } from "@/proto/ui/kit"

// Standalone preview of the habits Today cards (HAB-C1, HAB-C2) until the
// Today dashboard composes module cards.
export default function Page() {
  return (
    <Screen title="Today · Habits" back>
      <HabitsTodayCard />
    </Screen>
  )
}
