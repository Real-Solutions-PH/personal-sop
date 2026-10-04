import { useLocalSearchParams } from "expo-router"
import { ChatScreen } from "@/prototype/social/chat"
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <ChatScreen id={id} />
}
