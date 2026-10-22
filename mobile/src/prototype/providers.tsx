import { configureNotifications, setConnectivity } from "@domain/lib/platform"
import { configureStorage, flushStores } from "@domain/lib/store"
import { connectWorkoutHabits } from "@domain/wiring"
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular"
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium"
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold"
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono/400Regular"
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono/500Medium"
import NetInfo from "@react-native-community/netinfo"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
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

// Server reads that are not synced rows (e.g. the AI model catalogue).
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

export function PrototypeProviders({ children }: { children: ReactNode }) {
  const [fontsLoaded, fontError] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    GeistMono_400Regular,
    GeistMono_500Medium,
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
        <QueryClientProvider client={queryClient}>
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
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
