import { Redirect, Tabs } from "expo-router"
import { View } from "react-native"
import { OfflineBanner } from "@/components/offline-banner"
import { useAuthStore } from "@/stores/auth-store"

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) return <Redirect href="/login" />

  return (
    <View className="flex-1">
      <OfflineBanner />
      <Tabs screenOptions={{ headerShown: true }}>
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="items" options={{ title: "Items" }} />
        <Tabs.Screen name="settings" options={{ title: "Settings" }} />
      </Tabs>
    </View>
  )
}
