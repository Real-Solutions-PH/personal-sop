import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { HabitsHome } from "@/prototype/screens/habits-home"
export default function Page() {
  return (
    <FirstOpenSetup module="habits" href="/habits">
      <HabitsHome />
    </FirstOpenSetup>
  )
}
