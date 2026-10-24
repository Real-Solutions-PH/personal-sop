// expo-video has no native module under Jest; render videos as plain views.
jest.mock("expo-video", () => {
  const { View } = require("react-native")
  return {
    VideoView: View,
    useVideoPlayer: () => ({ play() {}, pause() {}, muted: true, loop: false }),
  }
})

// react-native-worklets 0.13 has no native module under Jest; use its own mock.
jest.mock("react-native-worklets", () =>
  require("react-native-worklets/lib/module/mock"),
)

// react-native-gesture-handler 3 ships its own Jest mocks for the native module.
require("react-native-gesture-handler/jestSetup")
