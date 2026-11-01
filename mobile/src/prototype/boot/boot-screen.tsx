// The boot screen: takes over from the native splash on its exact frame,
// animates the fiddlehead while storage and fonts load, then fades away to
// reveal the app, which has already rendered underneath.
import * as SplashScreen from "expo-splash-screen"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { StyleSheet, View } from "react-native"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { onScreenShown } from "./first-screen"
import { useSplashColors } from "./geometry"
import { type Stage, TIMING, UnfurlMark } from "./unfurl-mark"

// Keep the native splash up until the boot screen has drawn its first frame
// over it; otherwise iOS shows a blank frame between the two.
SplashScreen.preventAutoHideAsync().catch(() => {})

/** Longest wait for the first screen after the app has laid out. */
export const SCREEN_WAIT = 1500

/**
 * The app under the boot screen. The boot screen leaves only once the app's
 * first frame has been laid out, not merely once storage and fonts are in:
 * expo-router renders the app in a transition, so it can land well after
 * "ready", and a boot screen that left on "ready" alone uncovered a blank
 * white root view for seconds (seen under Reduce Motion, where there is no
 * intro to cover the gap). ``failed`` lets the storage error show at once.
 */
export function BootGate({
  ready,
  failed = false,
  children,
}: {
  ready: boolean
  failed?: boolean
  children: ReactNode
}) {
  const [laidOut, setLaidOut] = useState(false)
  const [painted, setPainted] = useState(false)
  // The app's container lays out a beat before the first screen in its
  // native stack draws: wait for that screen (it reports itself), or give
  // up waiting after SCREEN_WAIT so a screen that never reports cannot keep
  // the boot screen up.
  useEffect(() => {
    if (!laidOut) return
    const off = onScreenShown(() => setPainted(true))
    const t = setTimeout(() => setPainted(true), SCREEN_WAIT)
    return () => {
      off()
      clearTimeout(t)
    }
  }, [laidOut])
  return (
    <>
      {ready && (
        <View
          testID="app-root"
          style={{ flex: 1 }}
          onLayout={() => setLaidOut(true)}
        >
          {children}
        </View>
      )}
      <BootScreen ready={failed || (ready && painted)} />
    </>
  )
}

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
    // Under Reduce Motion nothing moves: the still mark fades to the app.
    if (reduced) {
      setStage("exit")
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
