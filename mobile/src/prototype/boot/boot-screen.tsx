// The boot screen: takes over from the native splash on its exact frame,
// animates the fiddlehead while storage and fonts load, then fades away to
// reveal the app, which has already rendered underneath.
import * as SplashScreen from "expo-splash-screen"
import { useEffect, useRef, useState } from "react"
import { StyleSheet } from "react-native"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSplashColors } from "./geometry"
import { type Stage, TIMING, UnfurlMark } from "./unfurl-mark"

// Keep the native splash up until the boot screen has drawn its first frame
// over it; otherwise iOS shows a blank frame between the two.
SplashScreen.preventAutoHideAsync().catch(() => {})

export function BootScreen({ ready }: { ready: boolean }) {
  const colors = useSplashColors()
  const reduced = useReducedMotion()
  const [stage, setStage] = useState<Stage>("intro")
  const [gone, setGone] = useState(false)
  const opacity = useSharedValue(1)
  const loopStart = useRef(0)
  const readyNow = useRef(ready)
  readyNow.current = ready
  // Intro, then loop until ready; leave at the end of a loop cycle so the
  // mark is back at rest when it fades.
  useEffect(() => {
    if (reduced || stage !== "intro") return
    const t = setTimeout(() => {
      loopStart.current = Date.now()
      setStage(readyNow.current ? "exit" : "loop")
    }, TIMING.intro)
    return () => clearTimeout(t)
  }, [reduced, stage])
  useEffect(() => {
    if (!ready || stage === "exit") return
    // Under Reduce Motion nothing moves: the splash frame simply goes.
    if (reduced) {
      setGone(true)
      return
    }
    if (stage !== "loop") return
    const into = (Date.now() - loopStart.current) % TIMING.loop
    const t = setTimeout(() => setStage("exit"), TIMING.loop - into)
    return () => clearTimeout(t)
  }, [ready, reduced, stage])
  useEffect(() => {
    if (stage === "exit")
      opacity.value = withTiming(0, { duration: TIMING.exit }, (done) => {
        if (done) runOnJS(setGone)(true)
      })
  }, [stage, opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  if (gone) return null
  return (
    <Animated.View
      pointerEvents={stage === "exit" ? "none" : "auto"}
      accessible
      accessibilityLabel="Opening Unfurl"
      onLayout={() => SplashScreen.hideAsync().catch(() => {})}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.ground,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <UnfurlMark stage={reduced ? "rest" : stage} color={colors.mark} />
    </Animated.View>
  )
}
