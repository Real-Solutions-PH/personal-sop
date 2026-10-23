// Builds signed by a free (personal) Apple team cannot carry the push
// entitlement that expo-notifications adds, and signing fails outright.
// With UNFURL_FREE_APPLE_TEAM=1 at prebuild this drops `aps-environment`
// and keeps every other entitlement (the widgets' keychain group, ADR-0020).
// Remote push then stays off until the build is signed by a paid team.
const { withEntitlementsPlist } = require("expo/config-plugins")

module.exports = (config) =>
  process.env.UNFURL_FREE_APPLE_TEAM === "1"
    ? withEntitlementsPlist(config, (c) => {
        delete c.modResults["aps-environment"]
        return c
      })
    : config
