import { useLocalSearchParams } from "expo-router"
import { GoalDetail } from "@/prototype/screens/finance-shared-groups"
export default function Page() {
  const p = useLocalSearchParams<{ id: string }>()
  return <GoalDetail goalId={p.id} />
}
