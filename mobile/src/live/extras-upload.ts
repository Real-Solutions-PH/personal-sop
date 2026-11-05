// The extras switches (Journal, Community, Weather, Calendar) used to live on
// one phone only. Once per account on this device, after a sync reached the
// server: an account that never chose takes this phone's switches; one that
// already chose (another phone, or onboarding) overrides them here.
import type { StorageAdapter } from "@domain/lib/store"
import { extrasStore } from "@/prototype/extras"
import type { Http } from "./http"
import { extrasFromServer, extrasToServer } from "./mappers/dash"

export const extrasUploadKey = (userId: string) =>
  `sop-live:extras-up:${userId}`

const inFlight = new Set<string>()

/** Resolves true once the account holds a choice (done for this device);
 * false leaves it for the next sync (offline, a server error). */
export async function settleDeviceExtras(
  userId: string,
  storage: StorageAdapter,
  http: Pick<Http, "request">,
): Promise<boolean> {
  const key = extrasUploadKey(userId)
  if (storage.getItem(key)) return true
  if (inFlight.has(userId)) return false
  inFlight.add(userId)
  try {
    const me = await http.request<{
      profile: { enabled_extras?: string[] | null }
    }>("GET", "/profile")
    const chosen = me.profile.enabled_extras
    if (Array.isArray(chosen)) {
      extrasStore.set((cur) => extrasFromServer(chosen, cur))
    } else {
      await http.request("PATCH", "/profile", {
        enabled_extras: extrasToServer(extrasStore.get()),
      })
    }
    storage.setItem(key, "1")
    return true
  } catch {
    return false
  } finally {
    inFlight.delete(userId)
  }
}
