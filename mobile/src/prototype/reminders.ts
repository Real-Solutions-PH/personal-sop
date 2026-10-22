// "Reminders are off → Fix": ask for notification permission right where the
// person is, or, when the system will no longer ask, open this app's page in
// the phone's Settings. Never a detour through onboarding.
import { setPush } from "@domain/dash/store"
import { Linking } from "react-native"
import { toast } from "sonner-native"

type Notifications = typeof import("expo-notifications")

/** Turning a reminder on: quiet when notifications are already allowed,
 * otherwise the same ask as "Reminders are off → Fix". */
export async function askForReminders(
  load: () => Notifications = () =>
    require("expo-notifications") as Notifications,
): Promise<void> {
  try {
    const p = await load().getPermissionsAsync()
    if (p.status === "granted") return
  } catch {
    return
  }
  await enableReminders(load)
}

export async function enableReminders(
  load: () => Notifications = () =>
    require("expo-notifications") as Notifications,
  openSettings: () => Promise<void> = () => Linking.openSettings(),
): Promise<"granted" | "denied" | "default"> {
  let N: Notifications
  try {
    N = load()
  } catch {
    toast.error("Reminders aren't available in this build.")
    return "default"
  }
  try {
    let p = await N.getPermissionsAsync()
    if (p.status !== "granted" && p.canAskAgain)
      p = await N.requestPermissionsAsync()
    if (p.status === "granted") {
      setPush({ permission: "granted" })
      toast.success("Reminders are on")
      const local =
        require("./local-reminders") as typeof import("./local-reminders")
      void local.syncReminders(N).catch(() => {})
      return "granted"
    }
    const status = p.status === "denied" ? "denied" : "default"
    setPush({ permission: status })
    if (!p.canAskAgain) {
      toast("Turn on notifications for Unfurl in Settings")
      await openSettings()
    } else toast("Reminders stay off. You can turn them on any time.")
    return status
  } catch {
    toast.error("Couldn't change notification settings. Try again.")
    return "default"
  }
}
