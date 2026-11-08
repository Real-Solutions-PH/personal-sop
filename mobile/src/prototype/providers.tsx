import { configureNotifications, setConnectivity } from "@domain/lib/platform"
import {
  configureStorage,
  flushStores,
  retryStoreReads,
} from "@domain/lib/store"
import { connectWorkoutHabits } from "@domain/wiring"
import { Geist_400Regular } from "@expo-google-fonts/geist/400Regular"
import { Geist_500Medium } from "@expo-google-fonts/geist/500Medium"
import { Geist_600SemiBold } from "@expo-google-fonts/geist/600SemiBold"
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono/400Regular"
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono/500Medium"
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useFonts } from "expo-font"
import { type ReactNode, useCallback, useEffect, useState } from "react"
import { AppState, Pressable, Text, View } from "react-native"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { BootGate } from "./boot/boot-screen"
import { contactGraceEnds, reachable } from "./connectivity"
import { connectHealthWorkouts } from "./health-workouts"
import { OverlayHost } from "./overlay"
import { healProfilePhoto } from "./profile-photo-heal"
import { sessionStore, startLiveSession } from "./session"
import { deferWrite, prototypeStorage } from "./storage"
import { AppToaster } from "./toaster"
import { logUsage } from "./usage"

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
if (liveMode)
  (
    require("@/live/query-refresh") as typeof import("@/live/query-refresh")
  ).installQueryRefresh(queryClient)

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
      configureStorage(
        prototypeStorage(),
        () =>
          queueMicrotask(() =>
            setError(
              "Local data could not be read or saved. Keep the app open and retry before closing.",
            ),
          ),
        { defer: deferWrite },
      )
      configureNotifications((message, options) => {
        const show =
          options?.tone === "error"
            ? toast.error
            : options?.tone === "warning"
              ? toast.warning
              : toast
        return show(message, {
          duration: options?.duration,
          action: options?.action
            ? { label: options.action.label, onClick: options.action.onClick }
            : undefined,
        })
      })
      // Retry: a store whose read was refused reads again before anything
      // is written, so the saved data wins over the stand-in.
      retryStoreReads()
      flushStores()
      // An update moves the app's files: the avatar follows its file.
      healProfilePhoto()
      setReady(true)
    } catch {
      setError("Local storage could not be opened. Please try again.")
    }
  }, [])
  useEffect(initialize, [initialize])
  // Store writes wait a beat (deferWrite): leaving the foreground writes
  // whatever is still waiting, since the app may not be woken again.
  useEffect(() => {
    // Opens and closes for the retention numbers (usage.ts): the launch
    // counts as an open; a close is sent at once, before the app sleeps.
    logUsage({ kind: "app_open" })
    let last = AppState.currentState
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flushStores()
      if (state === "active" && last !== "active")
        logUsage({ kind: "app_open" })
      else if (state === "background" && last !== "background")
        logUsage({ kind: "app_close" }, { now: true })
      last = state
    })
    return () => sub.remove()
  }, [])
  useEffect(() => connectWorkoutHabits(), [])
  useEffect(() => connectHealthWorkouts(), [])
  useEffect(() => {
    // Live mode: "online" means the app's own server answers, not that some
    // public site does. NetInfo's default probe (a Google URL) can fail on a
    // network that reaches the server fine, and the app then queued every
    // message as offline.
    if (liveMode) {
      const { API_URL, API_PREFIX } =
        require("@/live/config") as typeof import("@/live/config")
      NetInfo.configure({
        reachabilityUrl: `${API_URL}${API_PREFIX}/utils/health-check/`,
        reachabilityTest: async (r) => r.status === 200,
        reachabilityShortTimeout: 5_000,
        reachabilityLongTimeout: 30_000,
        // The bar every API call uses (REQUEST_TIMEOUT_MS): a slow mobile
        // link that answers in a few seconds is online, so it never shows
        // the offline banner or pauses sync.
        reachabilityRequestTimeout: 15_000,
      })
    }
  }, [])
  useEffect(() => {
    let recheck: ReturnType<typeof setTimeout> | undefined
    const apply = (state: NetInfoState, again = false) => {
      clearTimeout(recheck)
      const online = reachable(state)
      setConnectivity(online)
      // Online only on the server's recent answer: look again once that
      // grace runs out, in case the server has stopped answering since.
      if (online && state.isInternetReachable === false)
        recheck = setTimeout(
          () => apply(state, true),
          Math.max(contactGraceEnds() - Date.now(), 0) + 50,
        )
      if (online && liveMode && !again)
        (require("@/live/runtime") as typeof import("@/live/runtime")).syncNow()
    }
    const off = NetInfo.addEventListener((state) => apply(state))
    return () => {
      clearTimeout(recheck)
      off()
    }
  }, [])
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
            <StorageAlert
              message={error}
              onRetry={() => {
                setError(null)
                initialize()
              }}
            />
          )}
          <BootGate
            ready={ready && !!(fontsLoaded || fontError)}
            failed={!!error}
          >
            {children}
          </BootGate>
          <AppToaster />
          {/* Celebrations, above every screen, sheet and toast. */}
          <OverlayHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/** Clear of the status bar and the notch. */
function StorageAlert({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const insets = useSafeAreaInsets()
  return (
    <View
      accessibilityRole="alert"
      style={{
        padding: 16,
        paddingTop: 16 + insets.top,
        backgroundColor: "#FDE8DE",
      }}
    >
      <Text style={{ color: "#7E2D16" }}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={{ padding: 12 }}
      >
        <Text>Retry storage</Text>
      </Pressable>
    </View>
  )
}
