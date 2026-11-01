import { liveMode } from "@/live/config"
import { replace } from "./navigation"
import { signOut } from "./session"
import { confirm } from "./ui"

const plural = (n: number) => (n === 1 ? "1 change" : `${n} changes`)

/** The Sign out row: confirm, push what is queued, and only then clear the
 * device. Changes that could not reach the server (offline, or the push
 * failed) keep the person signed in unless they explicitly discard them. */
export function confirmSignOut() {
  confirm(
    "Sign out?",
    liveMode
      ? "Anything not yet synced is sent first, then this device is cleared. Sign back in any time."
      : "Your data stays on this device. Sign back in any time.",
    () => void attempt(false),
  )
}

async function attempt(discard: boolean) {
  const result = await signOut({ discard })
  if (result.ok) {
    replace("/welcome")
    return
  }
  confirm(
    `${plural(result.unsynced)} not synced yet`,
    "Connect to the internet first so they reach your account, then sign out. Signing out now deletes them from this device for good.",
    () => void attempt(true),
    "Discard and sign out",
  )
}
