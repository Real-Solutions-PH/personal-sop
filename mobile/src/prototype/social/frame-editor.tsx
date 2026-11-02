import { Image } from "expo-image"
import {
  Check,
  RectangleVertical,
  RotateCcw,
  Square,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native"
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { fonts, useTheme } from "../theme"
import {
  CENTRED,
  clampFraming,
  coverScale,
  type Framing,
  MAX_ZOOM,
  type PostRatio,
  type Size,
} from "./crop"
import { haptic } from "./kit"

export type FrameSource = { uri: string; width: number; height: number }

const RATIOS: { ratio: PostRatio; label: string; Icon: typeof Square }[] = [
  { ratio: 4 / 5, label: "4:5", Icon: RectangleVertical },
  { ratio: 1, label: "1:1", Icon: Square },
]

/** Frames a photo or a share card for a post, the way a photo app crops:
 * the picture always fills the frame. Pinch to zoom, drag to move,
 * double-tap to centre again; a rule-of-thirds grid shows while moving and
 * a light tap marks reaching an edge or the smallest zoom.
 *
 * ``framing`` offsets are in frame-width units in and out, so the result
 * does not depend on this screen's size. Only the picture is moved; what
 * the picture contains (a share card's layout) is never looked at. */
export function FrameEditor({
  source,
  ratio: initialRatio,
  framing: initial = CENTRED,
  ratios = true,
  onCancel,
  onDone,
}: {
  source: FrameSource
  ratio: PostRatio
  framing?: Framing
  /** Show the 4:5 / 1:1 choice. */
  ratios?: boolean
  onCancel: () => void
  onDone: (ratio: PostRatio, framing: Framing) => void
}) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const win = useWindowDimensions()
  const reduced = useReducedMotion()
  const [ratio, setRatio] = useState<PostRatio>(initialRatio)
  // The frame fills the width, and leaves room for the bars on a short
  // screen.
  const room = win.height - safe.top - safe.bottom - 220
  const fw = Math.min(win.width - 32, 560, room * ratio)
  const frame: Size = { width: fw, height: fw / ratio }
  const image: Size = { width: source.width, height: source.height }
  const base = coverScale(image, frame)
  const start = clampFraming(image, frame, {
    zoom: initial.zoom,
    x: initial.x * fw,
    y: initial.y * fw,
  })
  const zoom = useSharedValue(start.zoom)
  const x = useSharedValue(start.x)
  const y = useSharedValue(start.y)
  const grid = useSharedValue(0)
  // Which limit the picture is resting on, so the tap fires once on
  // reaching it rather than on every frame spent there.
  const pinned = useSharedValue(0)

  const settle = (f: Framing) => {
    "worklet"
    const c = clampFraming(image, frame, f)
    // An axis the picture only just covers has no edge to reach.
    const at =
      (f.zoom < 1 ? 1 : 0) |
      (c.x !== f.x && Math.abs(c.x) > 0.5 ? 2 : 0) |
      (c.y !== f.y && Math.abs(c.y) > 0.5 ? 4 : 0)
    if (at & ~pinned.value) runOnJS(haptic.tap)()
    pinned.value = at
    zoom.value = c.zoom
    x.value = c.x
    y.value = c.y
  }
  const show = () => {
    "worklet"
    grid.value = withTiming(1, { duration: 120 })
  }
  const hide = () => {
    "worklet"
    grid.value = withTiming(0, { duration: 240 })
  }

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(show)
    .onChange((e) => {
      settle({
        zoom: zoom.value,
        x: x.value + e.changeX,
        y: y.value + e.changeY,
      })
    })
    .onFinalize(hide)
  const pinch = Gesture.Pinch()
    .onStart(show)
    .onChange((e) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoom.value * e.scaleChange))
      const k = next / zoom.value
      const fx = e.focalX - frame.width / 2
      const fy = e.focalY - frame.height / 2
      settle({
        // Keeps the request below 1 visible to `settle`, which clamps it
        // and taps once on reaching the smallest zoom.
        zoom: zoom.value * e.scaleChange < 1 ? 0.999 : next,
        x: fx - (fx - x.value) * k,
        y: fy - (fy - y.value) * k,
      })
    })
    .onFinalize(hide)
  const reset = Gesture.Tap()
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd(() => {
      const d = reduced ? 0 : 220
      zoom.value = withTiming(1, { duration: d })
      x.value = withTiming(0, { duration: d })
      y.value = withTiming(0, { duration: d })
      pinned.value = 1
      runOnJS(haptic.tap)()
    })
  const gesture = Gesture.Simultaneous(pan, pinch, reset)

  const picture = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: zoom.value },
    ],
  }))
  const lines = useAnimatedStyle(() => ({ opacity: grid.value }))

  const done = () => {
    haptic.tap()
    onDone(ratio, {
      zoom: zoom.value,
      x: x.value / fw,
      y: y.value / fw,
    })
  }
  const pick = (r: PostRatio) => {
    if (r === ratio) return
    haptic.tap()
    // Keep the same spot on the picture centred in the new frame.
    const nw = Math.min(win.width - 32, 560, room * r)
    const next = clampFraming(
      image,
      { width: nw, height: nw / r },
      {
        zoom: zoom.value,
        x: (x.value / fw) * nw,
        y: (y.value / fw) * nw,
      },
    )
    zoom.value = next.zoom
    x.value = next.x
    y.value = next.y
    pinned.value = 0
    setRatio(r)
  }
  const resetNow = () => {
    haptic.tap()
    zoom.value = withTiming(1, { duration: reduced ? 0 : 220 })
    x.value = withTiming(0, { duration: reduced ? 0 : 220 })
    y.value = withTiming(0, { duration: reduced ? 0 : 220 })
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <GestureHandlerRootView
        style={{ flex: 1, backgroundColor: "#000000", paddingTop: safe.top }}
      >
        <View
          style={{
            height: 52,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 4,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            onPress={onCancel}
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={26} color="#ffffff" />
          </Pressable>
          <Text
            accessibilityRole="header"
            style={{
              flex: 1,
              textAlign: "center",
              color: "#ffffff",
              fontFamily: fonts.semibold,
              fontSize: 17,
            }}
          >
            Adjust
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            testID="frame-done"
            onPress={done}
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Check size={26} color={t.primary} />
          </Pressable>
        </View>
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <GestureDetector gesture={gesture}>
            <View
              testID="frame"
              accessibilityLabel={`Post frame ${RATIOS.find((r) => r.ratio === ratio)?.label}. Pinch to zoom, drag to move, double-tap to reset.`}
              collapsable={false}
              style={{
                width: frame.width,
                height: frame.height,
                overflow: "hidden",
                backgroundColor: "#000000",
              }}
            >
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    width: image.width * base,
                    height: image.height * base,
                    left: (frame.width - image.width * base) / 2,
                    top: (frame.height - image.height * base) / 2,
                  },
                  picture,
                ]}
              >
                <Image
                  source={{ uri: source.uri }}
                  contentFit="fill"
                  style={{ width: "100%", height: "100%" }}
                />
              </Animated.View>
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                  },
                  lines,
                ]}
              >
                {[1, 2].map((i) => (
                  <View
                    key={`v${i}`}
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: (frame.width * i) / 3,
                      width: 1,
                      backgroundColor: "#ffffff73",
                    }}
                  />
                ))}
                {[1, 2].map((i) => (
                  <View
                    key={`h${i}`}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (frame.height * i) / 3,
                      height: 1,
                      backgroundColor: "#ffffff73",
                    }}
                  />
                ))}
              </Animated.View>
            </View>
          </GestureDetector>
          <Text
            style={{
              color: "#ffffffa6",
              fontFamily: fonts.body,
              fontSize: 13,
              marginTop: 14,
            }}
          >
            Pinch to zoom · drag to move · double-tap to reset
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 10,
            paddingTop: 12,
            paddingBottom: safe.bottom + 16,
          }}
        >
          {ratios &&
            RATIOS.map(({ ratio: r, label, Icon }) => {
              const on = r === ratio
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityLabel={`Frame ${label}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => pick(r)}
                  style={{
                    minHeight: 44,
                    paddingHorizontal: 16,
                    borderRadius: 22,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: on ? "#ffffff" : "#ffffff1f",
                  }}
                >
                  <Icon size={16} color={on ? "#000000" : "#ffffff"} />
                  <Text
                    style={{
                      color: on ? "#000000" : "#ffffff",
                      fontFamily: fonts.semibold,
                      fontSize: 14,
                    }}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset framing"
            onPress={resetNow}
            style={{
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: 22,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              backgroundColor: "#ffffff1f",
            }}
          >
            <RotateCcw size={16} color="#ffffff" />
            <Text
              style={{
                color: "#ffffff",
                fontFamily: fonts.semibold,
                fontSize: 14,
              }}
            >
              Reset
            </Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  )
}
