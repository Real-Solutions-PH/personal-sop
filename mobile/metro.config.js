const path = require("node:path")
const { getDefaultConfig } = require("expo/metro-config")
const { withNativeWind } = require("nativewind/metro")
const config = getDefaultConfig(__dirname)
config.resolver.assetExts.push("wasm")
config.watchFolders = [path.resolve(__dirname, "../shared")]
// Shared domain modules must resolve the application's React instance.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")]
config.resolver.resolveRequest = (context, name, platform) => {
  const originModulePath = /^(react|react-dom|react-native)(\/|$)/.test(name)
    ? path.join(__dirname, "package.json")
    : context.originModulePath
  return context.resolveRequest(
    { ...context, originModulePath },
    name,
    platform,
  )
}
module.exports = withNativeWind(config, { input: "./global.css" })
