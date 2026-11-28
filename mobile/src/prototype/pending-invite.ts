// An invite link opened while signed out: kept (on this phone) until the
// person is signed in, then the app opens its accept screen once.
import { createStore } from "@domain/lib/store"

export const pendingInvite = createStore<{ token: string | null }>(
  "pending-invite",
  () => ({ token: null }),
)

export function setPendingInvite(token: string | undefined) {
  if (token && pendingInvite.get().token !== token)
    pendingInvite.set({ token })
}

/** The kept token, cleared as it is taken. */
export function takePendingInvite(): string | null {
  const { token } = pendingInvite.get()
  if (token) pendingInvite.set({ token: null })
  return token
}
