// Screen Time (FamilyControls + a DeviceActivity monitor extension) needs an
// entitlement Apple grants per App ID on request. Until it is granted, the
// native part is built only when UNFURL_SCREEN_TIME=1 at prebuild; without
// it this is app.json with the activity-monitor target and the native module
// left out, so production and TestFlight builds ship unchanged. The JS side
// finds no native module there and shows Screen Time as a locked preview.
const SCREEN_TIME_GROUP = "group.com.schadenkai.personal-sop"
const TARGETS = "@bacons/apple-targets"

module.exports = ({ config }) => {
  const on = process.env.UNFURL_SCREEN_TIME === "1"
  const match = on ? "{widget,activity-monitor}" : "widget"
  const plugins = (config.plugins ?? []).map((p) =>
    p === TARGETS ? [TARGETS, { match }] : p,
  )
  if (!on)
    return { ...config, plugins: [...plugins, "./plugins/without-screen-time"] }
  return {
    ...config,
    plugins,
    ios: {
      ...config.ios,
      entitlements: {
        ...config.ios?.entitlements,
        "com.apple.developer.family-controls": true,
        "com.apple.security.application-groups": [SCREEN_TIME_GROUP],
      },
    },
  }
}
