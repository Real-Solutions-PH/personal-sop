import { useQuery } from "@tanstack/react-query"
import { ScrollView, View } from "react-native"
import { Text } from "@/components/ui/text"
import * as itemsDb from "@/lib/db/items"
import * as usersDb from "@/lib/db/users"
import { useNetworkStore } from "@/stores/network-store"

export default function HomeScreen() {
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => usersDb.getCachedUser(),
  })

  const { data: itemCount } = useQuery({
    queryKey: ["items", "count"],
    queryFn: () => itemsDb.getLocalItemCount(),
  })

  const isWifi = useNetworkStore((s) => s.isWifi)
  const isConnected = useNetworkStore((s) => s.isConnected)
  const lastSyncAt = useNetworkStore((s) => s.lastSyncAt)

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="gap-4 p-6">
        <Text className="text-2xl font-bold">
          Hi{user?.full_name ? `, ${user.full_name}` : ""}
        </Text>
        <Text className="text-muted-foreground">{user?.email}</Text>

        <View className="mt-4 rounded-lg border border-border p-4">
          <Text className="mb-2 text-lg font-semibold">Dashboard</Text>
          <Text className="text-muted-foreground">
            {itemCount ?? 0} item{itemCount !== 1 ? "s" : ""}
          </Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            {isWifi
              ? "Connected (WiFi)"
              : isConnected
                ? "Cellular (sync paused)"
                : "Offline"}
          </Text>
          {lastSyncAt ? (
            <Text className="mt-1 text-xs text-muted-foreground">
              Last sync: {new Date(lastSyncAt).toLocaleString()}
            </Text>
          ) : null}
        </View>
      </View>
    </ScrollView>
  )
}
