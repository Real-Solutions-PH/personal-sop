// The Screen Time monitor (DeviceActivity). Built only with
// UNFURL_SCREEN_TIME=1 at prebuild: app.config.js leaves this directory out
// of @bacons/apple-targets' `match` otherwise. Shared.swift is a symlink to
// the module's copy so both sides agree on the App Group keys.
const APP_GROUP = "group.com.schadenkai.personal-sop"

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "device-activity-monitor",
  name: "ActivityMonitor",
  bundleIdentifier: ".activity-monitor",
  deploymentTarget: "16.4",
  frameworks: ["DeviceActivity"],
  entitlements: {
    "com.apple.developer.family-controls": true,
    "com.apple.security.application-groups": [APP_GROUP],
  },
})
