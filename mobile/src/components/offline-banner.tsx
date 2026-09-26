import { View } from "react-native"
import { Text } from "@/components/ui/text"
import { useNetworkStore } from "@/stores/network-store"

export function OfflineBanner() {
  const isConnected = useNetworkStore((s) => s.isConnected)
  const isWifi = useNetworkStore((s) => s.isWifi)

  if (isWifi) return null

  return (
    <View className="bg-muted px-4 py-2">
      <Text className="text-center text-xs text-muted-foreground">
        {isConnected
          ? "On cellular \u2014 sync paused (WiFi only)"
          : "Offline \u2014 changes saved locally"}
      </Text>
    </View>
  )
}
