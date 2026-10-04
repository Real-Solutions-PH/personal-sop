import { useLocalSearchParams } from "expo-router"
import { PostDetail } from "@/prototype/social/post"
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <PostDetail id={id} />
}
