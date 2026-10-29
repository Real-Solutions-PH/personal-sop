// app.config.js gates the Screen Time native part on UNFURL_SCREEN_TIME=1 at
// prebuild: without it the config is today's app.json with the
// activity-monitor target and the native module left out; with it the app gains the Family
// Controls entitlement and the App Group and the target is built.
import path from "node:path"

const appJson = require("../../app.json") as {
  expo: Record<string, any>
}
const appConfig = require("../../app.config.js") as (ctx: {
  config: Record<string, any>
}) => Record<string, any>

const FAMILY = "com.apple.developer.family-controls"
const GROUPS = "com.apple.security.application-groups"
const TARGETS = "@bacons/apple-targets"

const resolve = () => appConfig({ config: structuredClone(appJson.expo) })
const targetsPlugin = (config: Record<string, any>) =>
  (config.plugins as unknown[]).find(
    (p) => p === TARGETS || (Array.isArray(p) && p[0] === TARGETS),
  )
/** The target directories the plugin would build: the same glob it runs. */
const selected = (config: Record<string, any>) => {
  const p = targetsPlugin(config)
  const { root = "./targets", match = "*" } = Array.isArray(p) ? p[1] : {}
  const { globSync } = require("glob") as typeof import("glob")
  return globSync(`${root}/${match}/expo-target.config.@(json|js)`, {
    cwd: path.join(__dirname, "../.."),
  })
    .map((f) => path.basename(path.dirname(f)))
    .sort()
}

const saved = process.env.UNFURL_SCREEN_TIME
afterEach(() => {
  if (saved === undefined) delete process.env.UNFURL_SCREEN_TIME
  else process.env.UNFURL_SCREEN_TIME = saved
})

describe("UNFURL_SCREEN_TIME unset", () => {
  beforeEach(() => {
    delete process.env.UNFURL_SCREEN_TIME
  })

  it("is app.json with only the widget target and no native module", () => {
    const out = resolve()
    const expected = structuredClone(appJson.expo)
    expected.plugins = [
      ...expected.plugins.map((p: unknown) =>
        p === TARGETS ? [TARGETS, { match: "widget" }] : p,
      ),
      "./plugins/without-screen-time",
    ]
    expect(out).toEqual(expected)
    expect(selected(out)).toEqual(["widget"])
  })

  it("adds no Screen Time entitlements", () => {
    const ent = resolve().ios.entitlements
    expect(ent[FAMILY]).toBeUndefined()
    expect(ent[GROUPS]).toBeUndefined()
    expect(ent).toEqual(appJson.expo.ios.entitlements)
  })
})

describe("UNFURL_SCREEN_TIME=1", () => {
  beforeEach(() => {
    process.env.UNFURL_SCREEN_TIME = "1"
  })

  it("adds Family Controls and the App Group, keeping the keychain groups", () => {
    const ent = resolve().ios.entitlements
    expect(ent[FAMILY]).toBe(true)
    expect(ent[GROUPS]).toEqual(["group.com.schadenkai.personal-sop"])
    expect(ent["keychain-access-groups"]).toEqual(
      appJson.expo.ios.entitlements["keychain-access-groups"],
    )
  })

  it("builds the activity-monitor target beside the widget, and the module", () => {
    const out = resolve()
    expect(selected(out)).toEqual(["activity-monitor", "widget"])
    expect(out.plugins).not.toContain("./plugins/without-screen-time")
  })

  it("does not change app.json itself", () => {
    const before = structuredClone(appJson.expo)
    const input = structuredClone(appJson.expo)
    appConfig({ config: input })
    expect(input).toEqual(before)
  })
})
