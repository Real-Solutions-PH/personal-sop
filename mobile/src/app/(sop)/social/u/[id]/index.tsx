import { useLocalSearchParams } from "expo-router"
import { Profile } from "@/prototype/social/profile"
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <Profile id={id} />
}
