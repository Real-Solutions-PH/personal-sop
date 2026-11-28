import { useLocalSearchParams } from "expo-router"
import { JointAccountDetail } from "@/prototype/screens/finance-joint"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <JointAccountDetail accountId={p.id} />
}
