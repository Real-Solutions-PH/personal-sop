import { LinearGradient } from "expo-linear-gradient"
import {
  Camera,
  Dumbbell,
  type LucideIcon,
  Mic,
  Target,
  Trophy,
  Wallet,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native"
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg"
import { toast } from "sonner-native"
import {
  AuthButton,
  haptic,
  OrDivider,
  Rise,
  SocialButtons,
  Wordmark,
} from "../auth-kit"
import { go, replace } from "../navigation"
import { continueWith } from "../session"
import { fonts, useTheme } from "../theme"
import { Ring } from "../visual"

type Slide = {
  title: string
  body: string
  art: "rings" | "capture" | "score"
}
const SLIDES: Slide[] = [
  {
    title: "Run your days like a system.",
    body: "Habits, tasks, training, food and money in one daily operating procedure.",
    art: "rings",
  },
  {
    title: "Capture anything in seconds.",
    body: "Type it, say it or snap it. Each entry goes to the right section.",
    art: "capture",
  },
  {
    title: "Watch your Life Score climb.",
    body: "Streaks, reviews and goals turn ordinary days into progress you can see.",
    art: "score",
  },
]

function Chip({ icon: Icon, color }: { icon: LucideIcon; color: string }) {
  return (
    <View
      style={{
        width: 46,
        height: 46,
        borderRadius: 16,
        backgroundColor: `${color}33`,
        borderWidth: 1,
        borderColor: `${color}66`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={22} color={color} />
    </View>
  )
}
function Art({ kind }: { kind: Slide["art"] }) {
  const t = useTheme()
  if (kind === "rings")
    return (
      <Ring value={0.82} size={128} hero strokeWidth={10}>
        <Ring
          value={0.64}
          size={96}
          strokeWidth={10}
          color={t.fit}
          gradientColors={[t.fit, t.nut]}
          hero
        >
          <Ring
            value={0.9}
            size={64}
            strokeWidth={10}
            hero
            gradientColors={[t.primary, t.fin]}
          />
        </Ring>
      </Ring>
    )
  if (kind === "capture")
    return (
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Chip icon={Mic} color={t.hab} />
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 24,
            backgroundColor: "#ffffff1a",
            borderWidth: 1,
            borderColor: "#ffffff33",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Camera size={32} color="#fff" />
        </View>
        <Chip icon={Wallet} color={t.fin} />
      </View>
    )
  return (
    <View style={{ alignItems: "flex-start", gap: 10 }}>
      <Text
        style={{
          fontFamily: fonts.displayBlack,
          fontSize: 64,
          lineHeight: 68,
          color: "#fff",
        }}
      >
        87
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Chip icon={Target} color={t.hab} />
        <Chip icon={Dumbbell} color={t.fit} />
        <Chip icon={Trophy} color={t.life} />
      </View>
    </View>
  )
}

function Dot({
  active,
  index,
  onPress,
}: {
  active: boolean
  index: number
  onPress: () => void
}) {
  const reduced = useReducedMotion()
  const style = useAnimatedStyle(() => ({
    width: reduced ? (active ? 22 : 7) : withTiming(active ? 22 : 7),
    opacity: reduced ? (active ? 1 : 0.45) : withTiming(active ? 1 : 0.45),
  }))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show slide ${index + 1} of ${SLIDES.length}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      hitSlop={{ top: 16, bottom: 16, left: 4, right: 4 }}
      style={{
        height: 28,
        minWidth: 22,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[{ height: 7, borderRadius: 4, backgroundColor: "#fff" }, style]}
      />
    </Pressable>
  )
}

export function Welcome() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const pager = useRef<ScrollView>(null)
  const [width, setWidth] = useState(0)
  const [page, setPage] = useState(0)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState<"apple" | "google" | null>(null)

  const show = (i: number, animated = !reduced) => {
    setPage(i)
    pager.current?.scrollTo({ x: i * width, animated })
  }
  // Gentle auto-advance until the person swipes; off with reduced motion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: show is stable enough per render
  useEffect(() => {
    if (reduced || touched || !width) return
    const id = setTimeout(() => show((page + 1) % SLIDES.length), 4500)
    return () => clearTimeout(id)
  }, [page, width, touched, reduced])
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!width) return
    const next = Math.round(e.nativeEvent.contentOffset.x / width)
    if (next !== page && next >= 0 && next < SLIDES.length) setPage(next)
  }
  const social = async (provider: "apple" | "google") => {
    setBusy(provider)
    try {
      await continueWith(provider)
      haptic.success()
      replace("/today")
    } catch {
      setBusy(null)
      haptic.error()
      toast.error("Could not sign in. Please try again.")
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ flexGrow: 1 }}
      bounces={false}
    >
      <LinearGradient
        colors={[t["hero-from"], t["hero-via"], t["hero-to"]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          flexGrow: 1,
          minHeight: 400,
          paddingTop: safe.top + 16,
          paddingBottom: 48,
        }}
      >
        <Svg
          width="100%"
          height="100%"
          style={{ position: "absolute", top: 0, left: 0 }}
          pointerEvents="none"
        >
          <Defs>
            <RadialGradient
              id="welcome-glow-a"
              cx="100%"
              cy="0%"
              rx="90%"
              ry="60%"
            >
              <Stop offset="0" stopColor={t.hab} stopOpacity={0.55} />
              <Stop offset="0.7" stopColor={t.hab} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient
              id="welcome-glow-b"
              cx="0%"
              cy="100%"
              rx="80%"
              ry="55%"
            >
              <Stop offset="0" stopColor={t.primary} stopOpacity={0.45} />
              <Stop offset="0.7" stopColor={t.primary} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#welcome-glow-a)" />
          <Rect width="100%" height="100%" fill="url(#welcome-glow-b)" />
        </Svg>
        <Rise i={0} style={{ paddingHorizontal: 24 }}>
          <Wordmark />
        </Rise>
        <View
          style={{ flex: 1, justifyContent: "center" }}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        >
          {width > 0 && (
            <ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => setTouched(true)}
              accessibilityLabel="What Personal SOP does"
            >
              {SLIDES.map((s, i) => (
                <View
                  key={s.title}
                  accessible
                  accessibilityLabel={`${s.title} ${s.body}`}
                  accessibilityHint={`Slide ${i + 1} of ${SLIDES.length}`}
                  style={{
                    width,
                    paddingHorizontal: 28,
                    paddingTop: 24,
                    gap: 24,
                  }}
                >
                  <View style={{ height: 136, justifyContent: "center" }}>
                    <Art kind={s.art} />
                  </View>
                  <View style={{ gap: 10 }}>
                    <Text
                      style={{
                        fontFamily: fonts.displayHeavy,
                        fontSize: 36,
                        lineHeight: 38,
                        letterSpacing: -0.6,
                        color: "#fff",
                      }}
                    >
                      {s.title}
                    </Text>
                    <Text
                      style={{
                        fontFamily: fonts.body,
                        fontSize: 16,
                        lineHeight: 23,
                        color: "#ffffffc7",
                        maxWidth: 360,
                      }}
                    >
                      {s.body}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
        <View
          style={{
            flexDirection: "row",
            gap: 4,
            paddingHorizontal: 24,
            marginTop: 8,
          }}
        >
          {SLIDES.map((s, i) => (
            <Dot
              key={s.title}
              index={i}
              active={i === page}
              onPress={() => {
                setTouched(true)
                show(i)
              }}
            />
          ))}
        </View>
      </LinearGradient>
      <View
        style={{
          marginTop: -28,
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          backgroundColor: t.bg,
          paddingHorizontal: 20,
          paddingTop: 24,
          paddingBottom: safe.bottom + 16,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 460,
            alignSelf: "center",
            gap: 10,
          }}
        >
          <Rise i={2}>
            <AuthButton onPress={() => go("/signup")}>
              Create account
            </AuthButton>
          </Rise>
          <Rise i={3}>
            <AuthButton tone="secondary" onPress={() => go("/login")}>
              I already have an account
            </AuthButton>
          </Rise>
          <Rise i={4}>
            <OrDivider label="or continue with" />
            <SocialButtons busy={busy} onPress={social} />
          </Rise>
          <Rise i={5}>
            <Text
              style={{
                marginTop: 10,
                textAlign: "center",
                fontFamily: fonts.body,
                fontSize: 12,
                lineHeight: 17,
                color: t.muted,
              }}
            >
              By continuing you agree to the Terms and Privacy Policy. Your data
              stays on this device in the prototype.
            </Text>
          </Rise>
        </View>
      </View>
    </ScrollView>
  )
}
