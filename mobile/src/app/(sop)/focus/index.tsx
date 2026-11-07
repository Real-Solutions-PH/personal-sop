import { useLocalSearchParams } from "expo-router"
import { FirstOpenSetup } from "@/prototype/first-open-setup"
import { FocusTimer } from "@/prototype/screens/focus-timer"
export default function Page() {
  const { day } = useLocalSearchParams<{ day?: string }>()
  return (
    <FirstOpenSetup module="focus" href="/focus">
      <FocusTimer {...(day ? { day } : {})} />
    </FirstOpenSetup>
  )
}
