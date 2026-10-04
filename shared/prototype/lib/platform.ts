import { useSyncExternalStore } from "react"

let nativeOnline: boolean | undefined
const listeners = new Set<() => void>()
export function setConnectivity(online: boolean) {
  nativeOnline = online
  for (const listener of listeners) listener()
}
export function getConnectivity() {
  return (
    nativeOnline ??
    (typeof navigator === "undefined" || typeof navigator.onLine !== "boolean"
      ? true
      : navigator.onLine)
  )
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  const browserWindow =
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    typeof window.removeEventListener === "function"
      ? window
      : undefined
  if (browserWindow) {
    browserWindow.addEventListener("online", listener)
    browserWindow.addEventListener("offline", listener)
  }
  return () => {
    listeners.delete(listener)
    if (browserWindow) {
      browserWindow.removeEventListener("online", listener)
      browserWindow.removeEventListener("offline", listener)
    }
  }
}
export const useConnectivity = () =>
  useSyncExternalStore(subscribe, getConnectivity, () => true)
export interface ToastOptions {
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}
type Notify = (message: string, options?: ToastOptions) => unknown
let notify: Notify = () => {}
export function configureNotifications(next: Notify) {
  notify = next
}
export const toast = Object.assign(
  (message: string, options?: ToastOptions) => notify(message, options),
  {
    success: (message: string, options?: ToastOptions) =>
      notify(message, options),
  },
)
