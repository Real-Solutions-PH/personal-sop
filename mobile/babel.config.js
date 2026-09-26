module.exports = (api) => {
  // Vary the cached config by NODE_ENV so jest (NODE_ENV=test) can opt out of
  // nativewind: its `jsxImportSource` rewrites JSX in EVERY transformed file
  // — including @react-native/jest-preset's mocks — pulling in css-interop,
  // whose native runtime reads Appearance.getColorScheme() at load and crashes
  // under jest. Logic tests don't need styling, so drop it there.
  api.cache.using(() => process.env.NODE_ENV)
  const isTest = process.env.NODE_ENV === "test"
  const presets = [
    ["babel-preset-expo", isTest ? {} : { jsxImportSource: "nativewind" }],
  ]
  if (!isTest) {
    presets.push("nativewind/babel")
  }
  return { presets }
}
