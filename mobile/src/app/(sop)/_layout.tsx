import { dashStore, setOnboarded } from "@domain/dash/store"
import { captureUi, closeCapture, openCapture } from "@domain/lib/capture"
import { useConnectivity } from "@domain/lib/platform"
import { LaggingReads } from "@domain/lib/store"
import * as Haptics from "expo-haptics"
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
  ReduceMotion,
  runOnJS,
  type SharedValue,
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
import { fernPalette } from "@/prototype/companion/brand"
import { FernSprite } from "@/prototype/companion/fern-sprite"
import { DayMomentWatcher } from "@/prototype/day-moment"
import { startFocusLive } from "@/prototype/focus-live"
import { LiveBar } from "@/prototype/live-bar"
import { startReminders } from "@/prototype/local-reminders"
import { prototypeMode } from "@/prototype/mode"
import { replace, switchTab } from "@/prototype/navigation"
import { OfflineNote } from "@/prototype/offline-note"
import { startRestAlarm } from "@/prototype/rest-alarm"
import { FinishWatcher } from "@/prototype/routine-done"
import { startRunTracker } from "@/prototype/run-tracker"
import { startScreenSync } from "@/prototype/screen-sync"
import { CaptureOverlay } from "@/prototype/screens/capture"
import { sessionStore } from "@/prototype/session"
import { stepTab, TAB_ROUTES, tabDirection } from "@/prototype/tab-swipe"
import { AccentContext, fonts, useTheme } from "@/prototype/theme"
import { FirstTip, TourLayer, TourWatcher } from "@/prototype/tour/overlay"
import { useTourTarget } from "@/prototype/tour/targets"
import { TrophyWatcher } from "@/prototype/trophy-overlay"
import { wake } from "@/prototype/wake-word"
import { WakeWordListener } from "@/prototype/wake-word-listener"
import { SurfacesBridge } from "@/surfaces/bridge"

const tabs = [
  { label: "Today", href: "/today", icon: House },
  { label: "Plan", href: "/plan", icon: CalendarCheck2 },
  { label: "Fern", href: "/capture", icon: X },
  { label: "Stats", href: "/stats", icon: ChartColumn },
  { label: "Me", href: "/me", icon: User },
]
// The centre of the bar is Fern, the app's main way in: say or snap what
// happened, ask what you need. Fern turns into × while the drawer is open,
// and listens while "Hey Fern" is on. A press squeezes Fern down a little
// and lets go with a spring (a dip in opacity under Reduce Motion).
function FabIcon({
  open,
  hearing,
  press,
}: {
  open: boolean
  hearing: boolean
  press: SharedValue<number>
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const squeeze = useAnimatedStyle(() =>
    reduced
      ? { opacity: 1 - press.value * 0.35 }
      : { transform: [{ scale: 1 - press.value * 0.12 }] },
  )
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
    <Animated.View
      style={[
        {
          width: 48,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
        },
        squeeze,
      ]}
    >
      <Animated.View style={[{ position: "absolute" }, mark]}>
        <FernSprite
          size={48}
          state={hearing ? "listening" : "idle"}
          decorative
        />
      </Animated.View>
      <Animated.View style={[{ position: "absolute" }, close]}>
        <X size={26} strokeWidth={2.5} color={t.text} />
      </Animated.View>
    </Animated.View>
  )
}
const pressIn = (v: SharedValue<number>) => {
  v.value = withTiming(1, { duration: 90, reduceMotion: ReduceMotion.Never })
}
const pressOut = (v: SharedValue<number>) => {
  v.value = withSpring(0, {
    damping: 9,
    stiffness: 320,
    reduceMotion: ReduceMotion.Never,
  })
}
// A slow breathing halo marks Fern as the place to start; under Reduce
// Motion it only brightens and dims, never grows. Still while the drawer
// is open.
function FernHalo({ color, still }: { color: string; still: boolean }) {
  const reduced = useReducedMotion()
  const pulse = useSharedValue(0)
  useEffect(() => {
    const never = ReduceMotion.Never
    pulse.value = still
      ? withSpring(0)
      : withRepeat(
          withTiming(1, { duration: 2200, reduceMotion: never }),
          -1,
          true,
          undefined,
          never,
        )
  }, [still, pulse])
  const style = useAnimatedStyle(() => ({
    opacity: 0.22 + pulse.value * 0.18,
    transform: [{ scale: reduced ? 1 : 1 + pulse.value * 0.08 }],
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
  // An account that existed before this device signed in is never sent
  // into onboarding: Today's setup card finishes what is missing.
  const returning = sessionStore.use((s) => s.returning)
  const firstRun = ready && !onboarded && !returning
  const inFirstRun = path.startsWith("/onboarding") || path.startsWith("/setup")
  useEffect(() => {
    if (ready && !onboarded && returning) setOnboarded(true)
  }, [ready, onboarded, returning])
  useEffect(() => {
    if (firstRun && !inFirstRun) replace("/onboarding")
  }, [firstRun, inFirstRun])
  const focus =
    firstRun ||
    /^\/habits\/routines\/[^/]+\/play$/.test(path) ||
    /^\/habits\/[^/]+\/timer$/.test(path) ||
    path === "/focus" ||
    /^\/social\/(stories|story-new|chat|compose|new-chat)/.test(path) ||
    // First-run flows own the screen: their Continue sits where the bar is.
    inFirstRun ||
    path === "/capture"
  const reduced = useReducedMotion()
  const online = useConnectivity()
  const dir = tabDirection((s) => s.dir)
  const drawer = captureUi.use((s) => s.open)
  const hearing = wake((s) => s.armed)
  const fabPress = useSharedValue(0)
  const [bar, setBar] = useState(0)
  // The tour points at these tabs (tour/targets.ts).
  const tabTargets: Record<string, ReturnType<typeof useTourTarget>> = {
    Fern: useTourTarget("tab-fern"),
    Plan: useTourTarget("tab-plan"),
    Stats: useTourTarget("tab-stats"),
    Me: useTourTarget("tab-me"),
  }
  // Task and habit reminders as notifications scheduled on this phone.
  useEffect(() => startReminders(), [])
  // The focus timer's Live bar entry, end-of-set notice and catch-up.
  useEffect(() => startFocusLive(), [])
  useEffect(() => startRunTracker(), [])
  useEffect(() => startRestAlarm(), [])
  // Screen time: reconcile the monitor's events on every foreground.
  useEffect(() => startScreenSync(), [])
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
            {/* Floats over the page's bottom edge, above the bar. */}
            {!firstRun && <FirstTip path={path} barHeight={focus ? 0 : bar} />}
            <OfflineNote
              offline={!online}
              withBar={!focus}
              bottomInset={inset.bottom}
            />
          </View>
        </GestureDetector>
        {!focus && <LiveBar path={path} />}
        {/* Before the bar: the + button rises above the bar into the room the
            drawer leaves for it, so it must draw over the drawer. */}
        {!firstRun && (
          <>
            <CaptureOverlay bottom={focus ? 0 : bar} />
            <WakeWordListener onChatPage={path === "/capture"} />
            {/* Background watchers (widgets, trophies, streaks, moments)
                follow a change just after it, never inside the tap that
                made it: each recomputes summaries over all history. */}
            <LaggingReads.Provider value>
              <SurfacesBridge />
              <TrophyWatcher hidden={focus} />
              <FinishWatcher hidden={focus} />
              <DayMomentWatcher hidden={focus} />
            </LaggingReads.Provider>
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
                  ref={tab.label === "Fern" ? undefined : tabTargets[tab.label]}
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
                  onPressIn={
                    tab.label === "Fern" ? () => pressIn(fabPress) : undefined
                  }
                  onPressOut={
                    tab.label === "Fern" ? () => pressOut(fabPress) : undefined
                  }
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {})
                    if (tab.label === "Fern")
                      drawer ? closeCapture() : openCapture()
                    else if (path !== tab.href) {
                      if (drawer) closeCapture()
                      tabDirection.setState({ dir: 0 })
                      switchTab(tab.href)
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
                      ref={tabTargets.Fern}
                      style={{
                        marginTop: -30,
                        width: 72,
                        height: 72,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <FernHalo color={fern.sprout} still={drawer} />
                      <View
                        style={{
                          width: 60,
                          height: 60,
                          borderRadius: 30,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: t.line,
                          backgroundColor: t.card,
                          boxShadow: `0px 6px 14px ${fern.moss}33`,
                        }}
                      >
                        <FabIcon
                          open={drawer}
                          hearing={hearing}
                          press={fabPress}
                        />
                      </View>
                      {hearing && <ListeningBadge />}
                    </View>
                  ) : (
                    <View>
                      <TabIcon icon={Icon} active={active} />
                    </View>
                  )}
                  {/* Fern speaks for itself; the name is for screen readers. */}
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
        <TourWatcher path={path} />
        {!firstRun && (
          <TourLayer
            path={path}
            drawerOpen={drawer}
            barHeight={focus ? inset.bottom : bar}
          />
        )}
      </View>
    </AccentContext.Provider>
  )
}
