// expo-video has no native module under Jest; render videos as plain views.
jest.mock("expo-video", () => {
  const { View } = require("react-native")
  return {
    VideoView: View,
    useVideoPlayer: () => ({ play() {}, pause() {}, muted: true, loop: false }),
  }
})
