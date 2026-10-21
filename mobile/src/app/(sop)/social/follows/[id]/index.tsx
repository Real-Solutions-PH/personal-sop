import { useLocalSearchParams } from "expo-router"
import { Follows } from "@/prototype/social/profile"
export default function Page() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>()
  return (
    <Follows
      id={id}
      initialTab={tab === "following" ? "following" : "followers"}
    />
  )
}
