import { useLocalSearchParams } from "expo-router"
import { StoryViewer } from "@/prototype/social/stories"
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <StoryViewer id={id} />
}
