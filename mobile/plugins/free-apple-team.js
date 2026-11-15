// Builds signed by a free (personal) Apple team cannot carry the push
// entitlement that expo-notifications adds, and signing fails outright.
// With UNFURL_FREE_APPLE_TEAM=1 at prebuild this drops `aps-environment`
// and the Communication Notifications entitlement (Fern as a push's sender,
// targets/notification-service), and keeps every other entitlement (the
// widgets' keychain group, ADR-0020). Remote push then stays off until the
// build is signed by a paid team.
const { withEntitlementsPlist } = require("expo/config-plugins")

const PAID_ONLY = [
  "aps-environment",
  "com.apple.developer.usernotifications.communication",
]

module.exports = (config) =>
  process.env.UNFURL_FREE_APPLE_TEAM === "1"
    ? withEntitlementsPlist(config, (c) => {
        for (const key of PAID_ONLY) delete c.modResults[key]
        return c
      })
    : config
