import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { FocusTimer } from "@/prototype/screens/focus-timer"
export default function Page() {
  return (
    <FirstOpenSetup module="focus" href="/focus">
      <FocusTimer />
    </FirstOpenSetup>
  )
}
