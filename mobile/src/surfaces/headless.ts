import { fitStore } from "@domain/fitness/store"
import { habitsStore } from "@domain/habits/store"
import { liveStore } from "@domain/lib/live"
import { configureStorage, flushStores } from "@domain/lib/store"
import { AppRegistry, Platform } from "react-native"
import { prototypeStorage } from "@/prototype/storage"
import { drainSurfaceActions } from "./actions"
import { buildLiveState } from "./live-state"
import { writeLive } from "./native"

// Android: a tap on the ongoing notification or a widget while the app is
// not running starts this task (UnfurlSurfacesTaskService), so the action
// reaches the stores at once rather than on the next launch. The stores
// persist it, and the sync engine pushes it on its next start like any
// other edit (it diffs against the last state it sent).

export const HEADLESS_TASK = "UnfurlSurfacesDrain"

export async function surfacesHeadlessTask(): Promise<void> {
  configureStorage(prototypeStorage())
  if (!drainSurfaceActions()) return
  flushStores()
  writeLive(
    buildLiveState({
      live: liveStore.get().live,
      habits: habitsStore.get(),
      fit: fitStore.get(),
    }),
  )
}

export function registerSurfacesHeadless() {
  if (Platform.OS === "android")
    AppRegistry.registerHeadlessTask(HEADLESS_TASK, () => surfacesHeadlessTask)
}
