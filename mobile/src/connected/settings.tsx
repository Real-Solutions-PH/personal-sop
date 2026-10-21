import { View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useAuth } from "@/hooks/useAuth"
import { runSync } from "@/lib/sync"
import { useNetworkStore } from "@/stores/network-store"

export default function SettingsScreen() {
  const { logout, user } = useAuth()
  const syncStatus = useNetworkStore((s) => s.syncStatus)
  const lastSyncAt = useNetworkStore((s) => s.lastSyncAt)
  const pendingChanges = useNetworkStore((s) => s.pendingChangesCount)
  const isWifi = useNetworkStore((s) => s.isWifi)
  const isConnected = useNetworkStore((s) => s.isConnected)

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 gap-6 p-6">
        <Text className="text-2xl font-bold">Settings</Text>

        {user ? (
          <View className="gap-1">
            <Text className="text-sm text-muted-foreground">Signed in as</Text>
            <Text className="font-medium">{user.email}</Text>
          </View>
        ) : null}

        <View className="gap-1">
          <Text className="text-sm font-medium">Network</Text>
          <Text className="text-sm text-muted-foreground">
            {isWifi
              ? "WiFi connected"
              : isConnected
                ? "Cellular (sync paused)"
                : "Offline"}
          </Text>
        </View>

        <View className="gap-1">
          <Text className="text-sm font-medium">Sync</Text>
          <Text className="text-sm text-muted-foreground">
            Status: {syncStatus}
          </Text>
          {lastSyncAt ? (
            <Text className="text-sm text-muted-foreground">
              Last sync: {new Date(lastSyncAt).toLocaleString()}
            </Text>
          ) : null}
          {pendingChanges > 0 ? (
            <Text className="text-sm text-muted-foreground">
              {pendingChanges} change{pendingChanges !== 1 ? "s" : ""} waiting
              to sync
            </Text>
          ) : null}
        </View>

        <Button
          variant="outline"
          label={syncStatus === "syncing" ? "Syncing..." : "Sync Now"}
          onPress={() => runSync()}
          disabled={syncStatus === "syncing" || !isWifi}
        />

        <Button variant="destructive" label="Log out" onPress={logout} />
      </View>
    </SafeAreaView>
  )
}
