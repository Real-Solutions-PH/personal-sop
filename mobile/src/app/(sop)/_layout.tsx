import { dashStore } from "@domain/dash/store"
import { captureUi, closeCapture, openCapture } from "@domain/lib/capture"
import { liveStore } from "@domain/lib/live"
import { useConnectivity } from "@domain/lib/platform"
import * as Haptics from "expo-haptics"
import { LinearGradient } from "expo-linear-gradient"
import { Redirect, Stack, usePathname } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import {
  CalendarCheck2,
  ChartColumn,
  Ear,
  House,
  User,
  X,
} from "lucide-react-native"
import { useEffect, useState } from "react"
import { Pressable, Text, View } from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { syncReady } from "@/live/ready"
import { FernMark, fernPalette } from "@/prototype/companion/brand"
import { startReminders } from "@/prototype/local-reminders"
import { prototypeMode } from "@/prototype/mode"
import { go, replace } from "@/prototype/navigation"
import { CaptureOverlay } from "@/prototype/screens/capture"
import { stepTab, TAB_ROUTES, tabDirection } from "@/prototype/tab-swipe"
import { AccentContext, fonts, useTheme } from "@/prototype/theme"
import { wake } from "@/prototype/wake-word"
import { WakeWordListener } from "@/prototype/wake-word-listener"

const tabs = [
  { label: "Today", href: "/today", icon: House },
  { label: "Plan", href: "/plan", icon: CalendarCheck2 },
  { label: "Fern", href: "/capture", icon: X },
  { label: "Stats", href: "/stats", icon: ChartColumn },
  { label: "Me", href: "/me", icon: User },
]
// The centre of the bar is Fern, the app's main way in: say or snap what
// happened, ask what you need. The fiddlehead turns into × while her drawer
// is open.
function FabIcon({ open }: { open: boolean }) {
  const reduced = useReducedMotion()
  const turn = useSharedValue(open ? 1 : 0)
  useEffect(() => {
    turn.value = reduced
      ? open
        ? 1
        : 0
      : withSpring(open ? 1 : 0, { damping: 14, stiffness: 220 })
  }, [open, reduced, turn])
  const mark = useAnimatedStyle(() => ({
    opacity: 1 - turn.value,
    transform: [
      { rotate: `${turn.value * 90}deg` },
      { scale: 1 - turn.value * 0.4 },
    ],
  }))
  const close = useAnimatedStyle(() => ({
    opacity: turn.value,
    transform: [
      { rotate: `${(1 - turn.value) * -90}deg` },
      { scale: 0.6 + turn.value * 0.4 },
    ],
  }))
  return (
    <View style={{ width: 30, height: 30 }}>
      <Animated.View style={[{ position: "absolute" }, mark]}>
        <FernMark size={30} color="white" weight={2.2} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", left: 2, top: 2 }, close]}>
        <X size={26} strokeWidth={2.5} color="white" />
      </Animated.View>
    </View>
  )
}
// A slow breathing halo marks Fern as the place to start. Still when the
// person prefers reduced motion, and while the drawer is open.
function FernHalo({ color, still }: { color: string; still: boolean }) {
  const reduced = useReducedMotion()
  const pulse = useSharedValue(0)
  useEffect(() => {
    pulse.value =
      reduced || still
        ? withSpring(0)
        : withRepeat(withTiming(1, { duration: 2200 }), -1, true)
  }, [reduced, still, pulse])
  const style = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.18,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: "absolute",
          width: 72,
          height: 72,
          borderRadius: 36,
          backgroundColor: color,
        },
        style,
      ]}
    />
  )
}
// While "Hey Fern" is on, a small ear sits on Fern's button: the
// microphone is open and listening for the phrase.
function ListeningBadge() {
  const t = useTheme()
  const fern = fernPalette(t.dark)
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.bg,
        borderWidth: 1.5,
        borderColor: fern.sprout,
      }}
    >
      <Ear size={12} strokeWidth={2.4} color={fern.moss} />
    </View>
  )
}
// The icon pops when its tab becomes active.
function TabIcon({
  icon: Icon,
  active,
}: {
  icon: LucideIcon
  active: boolean
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const scale = useSharedValue(1)
  useEffect(() => {
    if (active && !reduced)
      scale.value = withSequence(
        withSpring(1.18, { duration: 160 }),
        withSpring(1, { damping: 12 }),
      )
  }, [active, reduced, scale])
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }))
  return (
    <Animated.View style={style}>
      <Icon
        size={20}
        strokeWidth={active ? 2.4 : 1.8}
        color={active ? t.text : t.muted}
      />
    </Animated.View>
  )
}
function swipeTo(path: string, dir: 1 | -1) {
  if (stepTab(path, dir)) void Haptics.selectionAsync().catch(() => {})
}
export default function PrototypeLayout() {
  const t = useTheme()
  const inset = useSafeAreaInsets()
  const path = usePathname()
  // Until onboarding is finished the app is onboarding and nothing else: no
  // bar, no Fern, no way round it. Setup is its last part. Waits for the
  // first sync so a returning person is never sent here by blank stores.
  const onboarded = dashStore.use((s) => s.onboarded)
  const ready = syncReady((s) => s.ready)
  const firstRun = ready && !onboarded
  const inFirstRun = path.startsWith("/onboarding") || path.startsWith("/setup")
  useEffect(() => {
    if (firstRun && !inFirstRun) replace("/onboarding")
  }, [firstRun, inFirstRun])
  const focus =
    firstRun ||
    /^\/habits\/routines\/[^/]+\/play$/.test(path) ||
    /^\/habits\/[^/]+\/timer$/.test(path) ||
    /^\/social\/(stories|story-new|chat|compose|new-chat)/.test(path) ||
    // First-run flows own the screen: their Continue sits where the bar is.
    inFirstRun ||
    path === "/capture"
  const reduced = useReducedMotion()
  const online = useConnectivity()
  const live = liveStore.use((s) => s.live)
  const dir = tabDirection((s) => s.dir)
  const drawer = captureUi.use((s) => s.open)
  const hearing = wake((s) => s.armed)
  const [bar, setBar] = useState(0)
  // Task and habit reminders as notifications scheduled on this phone.
  useEffect(() => startReminders(), [])
  const fern = fernPalette(t.dark)
  // Swiping slides tabs in from the side you swiped toward; tapping fades.
  const tabAnimation = {
    animation: reduced
      ? ("none" as const)
      : dir === 1
        ? ("slide_from_right" as const)
        : dir === -1
          ? ("slide_from_left" as const)
          : ("fade" as const),
    animationDuration: dir ? 260 : 180,
  }
  // Swipe sideways on a tab page to move between tabs. Rows, segment pagers
  // and calendars inside a page activate sooner, so they keep their swipes.
  const onTab = TAB_ROUTES.includes(path)
  const swipeTabs = Gesture.Pan()
    .enabled(onTab && !reduced)
    .activeOffsetX([-40, 40])
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      if (e.translationX < -80 || e.velocityX < -700) runOnJS(swipeTo)(path, 1)
      else if (e.translationX > 80 || e.velocityX > 700)
        runOnJS(swipeTo)(path, -1)
    })
  if (!prototypeMode) return <Redirect href="/login" />
  return (
    <AccentContext.Provider
      value={
        path.startsWith("/habits")
          ? "hab"
          : path.startsWith("/tasks")
            ? "tsk"
            : path.startsWith("/finance")
              ? "fin"
              : path.includes("nutrition")
                ? "nut"
                : path.startsWith("/fitness")
                  ? "fit"
                  : path.startsWith("/stats") || path.startsWith("/journal")
                    ? "life"
                    : "primary"
      }
    >
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <GestureDetector gesture={swipeTabs}>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerShown: false,
                gestureEnabled: true,
                animation: reduced ? "none" : "slide_from_right",
              }}
            >
              {/* Tab switches crossfade; drilling in still slides. */}
              <Stack.Screen name="today/index" options={tabAnimation} />
              <Stack.Screen name="plan/index" options={tabAnimation} />
              <Stack.Screen name="stats/index" options={tabAnimation} />
              <Stack.Screen name="me/index" options={tabAnimation} />
              <Stack.Screen
                name="onboarding/index"
                options={{ gestureEnabled: !firstRun }}
              />
              <Stack.Screen
                name="setup/index"
                options={{ gestureEnabled: !firstRun }}
              />
              <Stack.Screen
                name="social/stories/[id]/index"
                options={{
                  animation: reduced ? "none" : "fade_from_bottom",
                  presentation: "fullScreenModal",
                  gestureEnabled: false,
                }}
              />
              <Stack.Screen
                name="social/story-new/index"
                options={{
                  animation: reduced ? "none" : "slide_from_bottom",
                  presentation: "fullScreenModal",
                }}
              />
              <Stack.Screen
                name="social/compose/index"
                options={{ animation: reduced ? "none" : "slide_from_bottom" }}
              />
            </Stack>
          </View>
        </GestureDetector>
        {live && !focus && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Return to ${live.label}`}
            onPress={() => go(live.href)}
            style={{ padding: 12, backgroundColor: t.soft }}
          >
            <Text style={{ color: t.primary, fontWeight: "700" }}>
              {live.pausedAt ? "Paused" : "In progress"} · {live.label} →
            </Text>
          </Pressable>
        )}
        {!online && (
          <Text
            accessibilityRole="alert"
            style={{
              padding: 8,
              textAlign: "center",
              color: t.text,
              backgroundColor: t.soft,
            }}
          >
            Offline · changes stay on this device
          </Text>
        )}
        {/* Before the bar: the + button rises above the bar into the room the
            drawer leaves for it, so it must draw over the drawer. */}
        {!firstRun && (
          <>
            <CaptureOverlay bottom={focus ? 0 : bar} />
            <WakeWordListener onChatPage={path === "/capture"} />
          </>
        )}
        {!focus && (
          <View
            onLayout={(e) => setBar(e.nativeEvent.layout.height)}
            accessibilityRole="tablist"
            accessibilityLabel="Main navigation"
            style={{
              flexDirection: "row",
              paddingBottom: Math.max(inset.bottom, 8),
              paddingTop: 8,
              borderTopWidth: 1,
              borderColor: t.line,
              backgroundColor: t.bg,
            }}
          >
            {tabs.map((tab) => {
              const active =
                path === tab.href || path.startsWith(`${tab.href}/`)
              const Icon = tab.icon
              return (
                <Pressable
                  key={tab.href}
                  accessibilityRole="tab"
                  accessibilityLabel={
                    tab.label === "Fern"
                      ? drawer
                        ? "Close Fern"
                        : hearing
                          ? "Ask Fern. Listening for Hey Fern"
                          : "Ask Fern"
                      : tab.label
                  }
                  accessibilityHint={
                    tab.label === "Fern"
                      ? "Log anything or ask about your day, by typing, voice or photo"
                      : undefined
                  }
                  accessibilityState={{
                    selected: tab.label === "Fern" ? drawer : active,
                  }}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {})
                    if (tab.label === "Fern")
                      drawer ? closeCapture() : openCapture()
                    else if (path !== tab.href) {
                      if (drawer) closeCapture()
                      tabDirection.setState({ dir: 0 })
                      replace(tab.href)
                    }
                  }}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  {tab.label === "Fern" ? (
                    <View
                      style={{
                        marginTop: -30,
                        width: 72,
                        height: 72,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FernHalo color={fern.sprout} still={drawer} />
                      <LinearGradient
                        colors={[fern.frond, fern.moss]}
                        start={{ x: 0.2, y: 0 }}
                        end={{ x: 0.8, y: 1 }}
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: 30,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 3,
                          borderColor: t.bg,
                          boxShadow: `0px 6px 14px ${fern.moss}59`,
                        }}
                      >
                        <FabIcon open={drawer} />
                      </LinearGradient>
                      {hearing && <ListeningBadge />}
                    </View>
                  ) : (
                    <View>
                      <TabIcon icon={Icon} active={active} />
                    </View>
                  )}
                  {/* The orb speaks for itself; its name is for screen readers. */}
                  {tab.label !== "Fern" && (
                    <Text
                      style={{
                        fontSize: 11,
                        fontFamily: fonts.medium,
                        color: active ? t.text : t.muted,
                      }}
                    >
                      {tab.label}
                    </Text>
                  )}
                </Pressable>
              )
            })}
          </View>
        )}
      </View>
    </AccentContext.Provider>
  )
}
