/** Online for the app: connected to a network that reaches the internet.
 * A Wi-Fi with no uplink (captive portal, router without internet) is
 * connected but reports isInternetReachable false; null means the check
 * has not run yet, which is not taken as offline. */
export function reachable(state: {
  isConnected: boolean | null
  isInternetReachable?: boolean | null
}) {
  return state.isConnected !== false && state.isInternetReachable !== false
}
