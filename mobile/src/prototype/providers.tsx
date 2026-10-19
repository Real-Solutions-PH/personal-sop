import { configureNotifications, setConnectivity } from "@domain/lib/platform"
import { configureStorage, flushStores } from "@domain/lib/store"
import { connectWorkoutHabits } from "@domain/wiring"
import { Barlow_400Regular } from "@expo-google-fonts/barlow/400Regular"
import { Barlow_500Medium } from "@expo-google-fonts/barlow/500Medium"
import { Barlow_600SemiBold } from "@expo-google-fonts/barlow/600SemiBold"
import { Barlow_700Bold } from "@expo-google-fonts/barlow/700Bold"
import { BarlowCondensed_500Medium } from "@expo-google-fonts/barlow-condensed/500Medium"
import { BarlowCondensed_600SemiBold } from "@expo-google-fonts/barlow-condensed/600SemiBold"
import { BarlowCondensed_700Bold } from "@expo-google-fonts/barlow-condensed/700Bold"
import { BarlowCondensed_800ExtraBold } from "@expo-google-fonts/barlow-condensed/800ExtraBold"
import { BarlowCondensed_900Black } from "@expo-google-fonts/barlow-condensed/900Black"
import NetInfo from "@react-native-community/netinfo"
import { useFonts } from "expo-font"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { ActivityIndicator, Pressable, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Toaster, toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { sessionStore, startLiveSession } from "./session"
import { prototypeStorage } from "./storage"

// Live mode: server statistics refresh when a screen regains focus. Installed
// before any screen renders (the focus hook cannot be swapped in later).
if (liveMode)
  (
    require("@/live/stats") as typeof import("@/live/stats")
  ).installFocusRefresh()

export function PrototypeProviders({ children }: { children: ReactNode }) {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
    BarlowCondensed_900Black,
  })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const initialize = useCallback(() => {
    try {
      configureStorage(prototypeStorage(), () =>
        queueMicrotask(() =>
          setError(
            "Local data could not be read or saved. Keep the app open and retry before closing.",
          ),
        ),
      )
      configureNotifications((message, options) =>
        toast(message, {
          duration: options?.duration,
          action: options?.action
            ? { label: options.action.label, onClick: options.action.onClick }
            : undefined,
        }),
      )
      flushStores()
      setReady(true)
    } catch {
      setError("Local storage could not be opened. Please try again.")
    }
  }, [])
  useEffect(initialize, [initialize])
  useEffect(
    () =>
      connectWorkoutHabits((count) =>
        toast.success(
          `${count} workout habit${count === 1 ? "" : "s"} checked`,
        ),
      ),
    [],
  )
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        const online = state.isConnected !== false
        setConnectivity(online)
        if (online && liveMode)
          (
            require("@/live/runtime") as typeof import("@/live/runtime")
          ).syncNow()
      }),
    [],
  )
  // Live mode: the Supabase session decides whether the person is signed in;
  // a restored session starts sync without a sign-in screen.
  useEffect(() => {
    if (!liveMode || !ready) return
    void startLiveSession().then((uid) => {
      if (!uid && sessionStore.get().signedIn)
        sessionStore.set((s) => ({ ...s, signedIn: false, user: null }))
    })
  }, [ready])
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {error && (
          <View
            accessibilityRole="alert"
            style={{ padding: 16, backgroundColor: "#FDE8DE" }}
          >
            <Text style={{ color: "#7E2D16" }}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setError(null)
                initialize()
              }}
              style={{ padding: 12 }}
            >
              <Text>Retry storage</Text>
            </Pressable>
          </View>
        )}
        {!error && (!ready || (!fontsLoaded && !fontError)) && (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <ActivityIndicator accessibilityLabel="Opening Personal SOP" />
            <Text>Opening Personal SOP…</Text>
          </View>
        )}
        {ready && (fontsLoaded || fontError) && children}
        <Toaster />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
