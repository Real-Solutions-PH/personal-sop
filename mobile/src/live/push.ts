// Registers this device's Expo push token with the API
// (POST /profile/push-devices) so the server can deliver notifications.
//
// Skipped, silently, where push cannot work: the web build, Expo Go (remote
// push was removed from it), a build with no EAS project id, and a person
// who has not granted notification permission. The OS prompt is only shown
// when the person already said yes inside the app (dash ``push.permission``).

import { dashStore } from "@domain/dash/store"
import { Platform } from "react-native"
import type { Http } from "./http"

type Notifications = typeof import("expo-notifications")
type ConstantsModule = typeof import("expo-constants")

export interface PushDeps {
  http: Http
  /** Overridable for tests; defaults to the installed modules. */
  load?: () => { notifications: Notifications; constants: ConstantsModule }
  platform?: string
}

const defaultLoad = () => ({
  notifications: require("expo-notifications") as Notifications,
  constants: require("expo-constants") as ConstantsModule,
})

/** Resolves to the registered token, or null when push was skipped. */
export async function registerPushDevice(
  deps: PushDeps,
): Promise<string | null> {
  const platform = deps.platform ?? Platform.OS
  if (platform !== "ios" && platform !== "android") return null
  let mods: ReturnType<typeof defaultLoad>
  try {
    mods = (deps.load ?? defaultLoad)()
  } catch {
    return null // native module missing from this binary
  }
  const Constants = mods.constants.default
  if (Constants.executionEnvironment === "storeClient") return null // Expo Go
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  if (!projectId) return null
  const N = mods.notifications
  try {
    let { status } = await N.getPermissionsAsync()
    if (status !== "granted" && dashStore.get().push.permission === "granted")
      status = (await N.requestPermissionsAsync()).status
    if (status !== "granted") return null
    const { data: token } = await N.getExpoPushTokenAsync({ projectId })
    await deps.http.request("POST", "/profile/push-devices", {
      token,
      platform,
    })
    return token
  } catch {
    return null // retried at the next launch
  }
}
