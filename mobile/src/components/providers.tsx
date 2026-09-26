import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { GestureHandlerRootView } from "react-native-gesture-handler"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { Toaster } from "sonner-native"
import { useNetworkStatus } from "@/hooks/useNetworkStatus"
import { useSupabaseAuthSync } from "@/hooks/useSupabaseAuthSync"
import { useSyncOnForeground } from "@/hooks/useSyncOnForeground"
import { initializeDatabase } from "@/lib/database"

initializeDatabase()

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60,
      networkMode: "always",
    },
    mutations: {
      networkMode: "always",
    },
  },
})

interface ProvidersProps {
  children: ReactNode
}

function AppInitializer() {
  useNetworkStatus()
  useSyncOnForeground()
  useSupabaseAuthSync()
  return null
}

export function Providers({ children }: ProvidersProps) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AppInitializer />
          {children}
          <Toaster />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
