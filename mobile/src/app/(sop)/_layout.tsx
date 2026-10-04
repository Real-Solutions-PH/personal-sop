import { openCapture } from "@domain/lib/capture"
import { liveStore } from "@domain/lib/live"
import { useConnectivity } from "@domain/lib/platform"
import * as Haptics from "expo-haptics"
import { LinearGradient } from "expo-linear-gradient"
import { Redirect, Stack, usePathname } from "expo-router"
import type { LucideIcon } from "lucide-react-native"
import { CalendarCheck2, House, Plus, User, Users } from "lucide-react-native"
import { useEffect } from "react"
import { Pressable, Text, View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { prototypeMode } from "@/prototype/mode"
import { go, replace } from "@/prototype/navigation"
import { CaptureOverlay } from "@/prototype/screens/capture"
import { socialStore, unread } from "@/prototype/social/store"
import { AccentContext, fonts, useTheme } from "@/prototype/theme"

const tabs = [
  { label: "Today", href: "/today", icon: House },
  { label: "Plan", href: "/plan", icon: CalendarCheck2 },
  { label: "Capture", href: "/capture", icon: Plus },
  { label: "Social", href: "/social", icon: Users },
  { label: "Me", href: "/me", icon: User },
]
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
export default function PrototypeLayout() {
  const t = useTheme()
  const inset = useSafeAreaInsets()
  const path = usePathname()
  const focus =
    /^\/habits\/routines\/[^/]+\/play$/.test(path) ||
    /^\/habits\/[^/]+\/timer$/.test(path) ||
    /^\/social\/(stories|story-new|chat|compose|new-chat)/.test(path)
  const reduced = useReducedMotion()
  const online = useConnectivity()
  const live = liveStore.use((s) => s.live)
  const dms = socialStore.use(
    (s) => s.chats.filter((c) => !c.muted && unread(c) > 0).length,
  )
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
        <Stack
          screenOptions={{
            headerShown: false,
            gestureEnabled: true,
            animation: reduced ? "none" : "slide_from_right",
          }}
        >
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
        {!focus && (
          <View
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
                  accessibilityLabel={tab.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {})
                    if (tab.label === "Capture") openCapture()
                    else if (path !== tab.href) replace(tab.href)
                  }}
                  style={{
                    flex: 1,
                    minHeight: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                  }}
                >
                  {tab.label === "Capture" ? (
                    <LinearGradient
                      colors={[t.primary, t.hab]}
                      style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: -23,
                        boxShadow: "0px 4px 10px #007c7040",
                      }}
                    >
                      <Plus size={28} strokeWidth={2.5} color="white" />
                    </LinearGradient>
                  ) : (
                    <View>
                      <TabIcon icon={Icon} active={active} />
                      {tab.label === "Social" && dms > 0 && (
                        <View
                          accessibilityLabel={`${dms} unread messages`}
                          style={{
                            position: "absolute",
                            top: -3,
                            right: -6,
                            width: 9,
                            height: 9,
                            borderRadius: 5,
                            backgroundColor: "#ff3040",
                            borderWidth: 1.5,
                            borderColor: t.bg,
                          }}
                        />
                      )}
                    </View>
                  )}
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: fonts.medium,
                      color: active ? t.text : t.muted,
                    }}
                  >
                    {tab.label === "Capture" ? "" : tab.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}
        <CaptureOverlay />
      </View>
    </AccentContext.Provider>
  )
}
