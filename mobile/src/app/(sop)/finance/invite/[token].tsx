import { useLocalSearchParams } from "expo-router"
import { InviteScreen } from "@/prototype/screens/finance-joint"
export default function Page() {
  const p = useLocalSearchParams<{ token: string }>()
  return <InviteScreen token={p.token} />
}
