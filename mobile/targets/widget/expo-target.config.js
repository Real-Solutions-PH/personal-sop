// Home-screen widgets and the Live Activity (ADR-0020). Built by
// @bacons/apple-targets at prebuild; files in _shared/ are compiled into the
// app target too.
const { palette } = require("../../../shared/prototype/design/tokens.ts")

const tone = (key) => ({ light: palette.light[key], dark: palette.dark[key] })

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  name: "UnfurlWidgets",
  displayName: "Unfurl",
  bundleIdentifier: ".widgets",
  deploymentTarget: "17.0",
  frameworks: ["WidgetKit", "SwiftUI", "ActivityKit", "AppIntents"],
  colors: {
    $accent: tone("primary"),
    $widgetBackground: tone("card"),
    card: tone("card"),
    text: tone("foreground"),
    muted: tone("muted-foreground"),
    soft: tone("muted"),
    line: tone("border"),
    primary: tone("primary"),
    hab: tone("hab"),
    tsk: tone("tsk"),
    fit: tone("fit"),
    nut: tone("nut"),
    fin: tone("fin"),
    life: tone("life"),
    warn: tone("warn"),
    foc: tone("foc"),
    scr: tone("scr"),
    // Fern's own greens: the orb and the Fern buttons only (docs/brand/fern.md).
    moss: tone("moss"),
    frond: tone("frond"),
    sprout: tone("sprout"),
  },
  entitlements: {
    // A keychain group under the team's own prefix, which a free (personal)
    // team can sign; App Groups need a paid account. See SharedStore.
    "keychain-access-groups": [
      `$(AppIdentifierPrefix)${config.ios.bundleIdentifier}.surfaces`,
    ],
  },
})
