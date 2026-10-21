import { getConnectivity, useConnectivity } from "../lib/platform"
import { createStore } from "../lib/store"
import { type CaptureState, seed } from "./data"
export const captureStore = createStore<CaptureState>("capture", seed)
export const isOnline = () =>
  getConnectivity() && !captureStore.get().settings.simulateOffline
export function useOnline() {
  const simulated = captureStore.use((s) => s.settings.simulateOffline)
  const connected = useConnectivity()
  return connected && !simulated
}
