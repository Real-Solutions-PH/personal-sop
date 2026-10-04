import { useLocalSearchParams } from "expo-router"
import { Follows } from "@/prototype/social/profile"
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Follows id={id} />
}
