/** A failed reachability probe within this long of the server answering is
 * not taken as offline: the probe (a HEAD with its own timeout) can miss on
 * a slow or busy link while a reply streams in fine. */
export const CONTACT_GRACE_MS = 30_000

let lastContact = 0
/** The server just answered (a response, a frame of a stream). */
export function noteServerContact(at = Date.now()) {
  lastContact = at
}
/** When the grace from the last answer runs out (0 if never heard). */
export const contactGraceEnds = () =>
  lastContact ? lastContact + CONTACT_GRACE_MS : 0

/** Online for the app: connected to a network that reaches the internet.
 * A Wi-Fi with no uplink (captive portal, router without internet) is
 * connected but reports isInternetReachable false; null means the check
 * has not run yet, which is not taken as offline. A failed check while the
 * server answered within ``CONTACT_GRACE_MS`` is not offline either: Fern's
 * long reply streaming in proves the link works. */
export function reachable(
  state: {
    isConnected: boolean | null
    isInternetReachable?: boolean | null
  },
  now = Date.now(),
) {
  if (state.isConnected === false) return false
  return state.isInternetReachable !== false || now < contactGraceEnds()
}
