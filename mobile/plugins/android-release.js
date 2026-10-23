// Android settings for sideloaded release builds, applied at prebuild.
//
// Cleartext: a test build pointed at the API on the LAN talks plain HTTP. When
// EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SUPABASE_URL are http:// at prebuild, this
// writes a network security config that allows cleartext to those hosts only;
// every other host stays HTTPS-only. With https:// URLs (production) nothing is
// added. The config replaces `usesCleartextTraffic`, so a debug build prebuilt
// this way reaches Metro only if Metro's host is one of those hosts.
//
// Signing: the release build type signs with the upload keystore described by
// the properties file at UNFURL_ANDROID_KEYSTORE_PROPERTIES (default
// ~/.unfurl/android/keystore.properties: storeFile, storePassword, keyAlias,
// keyPassword). Without the file, release keeps the template's debug signing.
// The keystore and its passwords live outside the repository.
const fs = require("node:fs")
const path = require("node:path")
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins")

const cleartextHosts = () => {
  const hosts = new Set()
  for (const raw of [
    process.env.EXPO_PUBLIC_API_URL,
    process.env.EXPO_PUBLIC_SUPABASE_URL,
  ]) {
    if (!raw) continue
    const url = new URL(raw)
    if (url.protocol === "http:") hosts.add(url.hostname)
  }
  return [...hosts]
}

const networkSecurityConfig = (hosts) => `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
${hosts.map((h) => `    <domain includeSubdomains="false">${h}</domain>`).join("\n")}
  </domain-config>
</network-security-config>
`

const withCleartextHosts = (config) => {
  const hosts = cleartextHosts()
  if (hosts.length === 0) return config
  const withXml = withDangerousMod(config, [
    "android",
    (c) => {
      const dir = path.join(
        c.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      )
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, "network_security_config.xml"),
        networkSecurityConfig(hosts),
      )
      return c
    },
  ])
  return withAndroidManifest(withXml, (c) => {
    const app = c.modResults.manifest.application[0]
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config"
    return c
  })
}

const SIGNING_MARKER = "// unfurl-android-release signing"

const signingGradle = `
${SIGNING_MARKER}
def unfurlKeystoreProps = file(System.getenv("UNFURL_ANDROID_KEYSTORE_PROPERTIES") ?: "\${System.getProperty("user.home")}/.unfurl/android/keystore.properties")
if (unfurlKeystoreProps.exists()) {
    def p = new Properties()
    unfurlKeystoreProps.withInputStream { p.load(it) }
    android.signingConfigs.create("unfurlUpload") {
        storeFile file(p.getProperty("storeFile"))
        storePassword p.getProperty("storePassword")
        keyAlias p.getProperty("keyAlias")
        keyPassword p.getProperty("keyPassword")
    }
    android.buildTypes.release.signingConfig android.signingConfigs.unfurlUpload
}
`

const withUploadSigning = (config) =>
  withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(SIGNING_MARKER)) {
      c.modResults.contents += signingGradle
    }
    return c
  })

module.exports = (config) => withUploadSigning(withCleartextHosts(config))
