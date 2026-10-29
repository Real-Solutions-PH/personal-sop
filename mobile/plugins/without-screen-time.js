// Leaves the Screen Time native module (modules/unfurl-screen-time) out of
// the iOS build. Local modules in modules/ are autolinked unconditionally, so
// without this a build prebuilt without UNFURL_SCREEN_TIME=1 would still
// link FamilyControls and the JS side would find the module and offer a
// feature the build has no entitlement for. app.config.js adds this plugin
// only when UNFURL_SCREEN_TIME is not "1".
const { withPodfile } = require("expo/config-plugins")

const MODULE = "unfurl-screen-time"
const CALL = /^([ \t]*)use_expo_modules![ \t]*$/m

module.exports = (config) =>
  withPodfile(config, (c) => {
    const podfile = c.modResults.contents
    if (podfile.includes(`exclude: ['${MODULE}']`)) return c
    if (!CALL.test(podfile))
      throw new Error(
        `[without-screen-time] no bare \`use_expo_modules!\` in the Podfile to exclude ${MODULE} from`,
      )
    c.modResults.contents = podfile.replace(
      CALL,
      `$1use_expo_modules!(exclude: ['${MODULE}'])`,
    )
    return c
  })
