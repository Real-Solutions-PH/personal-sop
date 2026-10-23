import { type ReactNode, useEffect, useRef, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native"
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  AuthButton,
  haptic,
  OrDivider,
  Rise,
  SocialButtons,
  Wordmark,
} from "../auth-kit"
import { fernPalette } from "../companion/brand"
import { Orb } from "../companion/orb"
import { companionStore } from "../companion/store"
import { go, replace } from "../navigation"
import { continueWith } from "../session"
import { fonts, radius, space, useTheme } from "../theme"

// Each slide states one product promise from the positioning's messaging
// pillars (docs/brand/positioning-and-name.md), shown with the app's own
// pieces: Fern's orb and bubbles, plain cards, 8 pt module dots, mono numbers.
type Art = "say" | "one" | "ask"
type Slide = { art: Art; title: string; body: (fern: string) => string }
const SLIDES: Slide[] = [
  {
    art: "say",
    title: "Say it. It's tracked.",
    body: (fern) =>
      `Tell ${fern} what happened in a sentence, a voice note or a photo. It lands in the right place.`,
  },
  {
    art: "one",
    title: "One app, not five.",
    body: () =>
      "Habits, tasks, training, food and money, on one page you can read at a glance.",
  },
  {
    art: "ask",
    title: "Ask, don't dig.",
    body: (fern) =>
      `Ask ${fern} about your week. The answer comes from your own records.`,
  },
]
const ART_HEIGHT = 264
const ease = Easing.out(Easing.cubic)

function You({ children }: { children: string }) {
  const t = useTheme()
  return (
    <View
      style={{
        alignSelf: "flex-end",
        maxWidth: "82%",
        backgroundColor: t.soft,
        borderRadius: radius.card,
        borderBottomRightRadius: 6,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.body,
          fontSize: 15,
          lineHeight: 21,
          color: t.text,
        }}
      >
        {children}
      </Text>
    </View>
  )
}

/** Fern's reply: the orb beside a `mist` bubble (Fern's colours, Fern only). */
function FernSays({ children }: { children: ReactNode }) {
  const t = useTheme()
  const p = fernPalette(t.dark)
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <Orb size={28} />
      <View
        style={{
          flexShrink: 1,
          maxWidth: "86%",
          backgroundColor: p.mist,
          borderRadius: radius.card,
          borderBottomLeftRadius: 6,
          paddingHorizontal: 14,
          paddingVertical: 10,
          gap: 6,
        }}
      >
        {children}
      </View>
    </View>
  )
}

function Words({ children }: { children: string }) {
  const t = useTheme()
  return (
    <Text
      style={{
        fontFamily: fonts.body,
        fontSize: 15,
        lineHeight: 21,
        color: t.text,
      }}
    >
      {children}
    </Text>
  )
}

const Dot = ({ color }: { color: string }) => (
  <View
    style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
  />
)

/** One filed record inside Fern's reply: module dot, label, mono value. */
function Filed({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Dot color={color} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.text }}>
        {label}
      </Text>
      <Text
        style={{ fontFamily: fonts.monoRegular, fontSize: 13, color: t.muted }}
      >
        {value}
      </Text>
    </View>
  )
}

function SayArt() {
  const t = useTheme()
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: space.lg }}>
      <View style={{ alignItems: "center", marginBottom: space.sm }}>
        <Orb size={72} />
      </View>
      <You>Lunch was 250 and I did squats, 3 sets of 8</You>
      <FernSays>
        <Words>I logged both.</Words>
        <Filed color={t.fin} label="Money" value="₱250.00 · Food" />
        <Filed color={t.fit} label="Training" value="Squat 3 × 8" />
      </FernSays>
    </View>
  )
}

function OneArt() {
  const t = useTheme()
  const rows: { key: string; color: string; label: string; value: string }[] = [
    { key: "hab", color: t.hab, label: "Habits", value: "4 / 5" },
    { key: "tsk", color: t.tsk, label: "Tasks", value: "3 left" },
    { key: "fit", color: t.fit, label: "Training", value: "Push day" },
    { key: "nut", color: t.nut, label: "Protein", value: "96 / 140 g" },
    { key: "fin", color: t.fin, label: "Money", value: "₱1,240 left" },
  ]
  return (
    <View style={{ flex: 1, justifyContent: "center" }}>
      <View
        style={{
          backgroundColor: t.card,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: t.line,
          paddingHorizontal: space.lg,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "baseline",
            paddingTop: 14,
            paddingBottom: 6,
          }}
        >
          <Text
            style={{ fontFamily: fonts.semibold, fontSize: 15, color: t.text }}
          >
            Today
          </Text>
          <Text
            style={{
              fontFamily: fonts.monoRegular,
              fontSize: 12,
              color: t.muted,
            }}
          >
            Thu 23 Oct
          </Text>
        </View>
        {rows.map((r, i) => (
          <View
            key={r.key}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              minHeight: 40,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: t.line,
            }}
          >
            <Dot color={r.color} />
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.body,
                fontSize: 15,
                color: t.text,
              }}
            >
              {r.label}
            </Text>
            <Text
              style={{ fontFamily: fonts.mono, fontSize: 14, color: t.text }}
            >
              {r.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  )
}

// Food spend per day, Mon to Thu (today), in pesos.
const WEEK = [
  { day: "Mon", value: 420 },
  { day: "Tue", value: 310 },
  { day: "Wed", value: 860 },
  { day: "Thu", value: 250 },
]
function AskArt() {
  const t = useTheme()
  const max = Math.max(...WEEK.map((d) => d.value))
  return (
    <View style={{ flex: 1, justifyContent: "center", gap: space.lg }}>
      <You>How much did I spend on food this week?</You>
      <FernSays>
        <Words>₱1,840.00 since Monday, ₱180 less than last week.</Words>
        <View
          accessible
          accessibilityLabel="Food spend: Mon 420, Tue 310, Wed 860, Thu 250"
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: 10,
            height: 84,
            marginTop: 4,
          }}
        >
          {WEEK.map((d, i) => {
            const today = i === WEEK.length - 1
            return (
              <View key={d.day} style={{ alignItems: "center", gap: 3 }}>
                <Text
                  style={{
                    fontFamily: fonts.monoRegular,
                    fontSize: 12,
                    color: today ? t.text : t.muted,
                  }}
                >
                  {d.value}
                </Text>
                <View
                  style={{
                    width: 26,
                    height: Math.max(6, (d.value / max) * 44),
                    borderRadius: 4,
                    backgroundColor: t.fin,
                    // Past days in a light tint, today at full strength.
                    opacity: today ? 1 : 0.35,
                  }}
                />
                <Text
                  style={{
                    fontFamily: today ? fonts.medium : fonts.body,
                    fontSize: 12,
                    color: today ? t.text : t.muted,
                  }}
                >
                  {d.day}
                </Text>
              </View>
            )
          })}
        </View>
      </FernSays>
    </View>
  )
}

function SlideArt({ art }: { art: Art }) {
  if (art === "say") return <SayArt />
  if (art === "one") return <OneArt />
  return <AskArt />
}

function PageDot({
  active,
  index,
  onPress,
}: {
  active: boolean
  index: number
  onPress: () => void
}) {
  const t = useTheme()
  const reduced = useReducedMotion()
  const style = useAnimatedStyle(() => ({
    width: reduced
      ? active
        ? 20
        : 8
      : withTiming(active ? 20 : 8, { duration: 240, easing: ease }),
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
        minWidth: 20,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            height: 8,
            borderRadius: 4,
            backgroundColor: active ? t.text : t.input,
          },
          style,
        ]}
      />
    </Pressable>
  )
}

export function Welcome() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const fern = companionStore.use((s) => s.name)
  const pager = useRef<ScrollView>(null)
  const [width, setWidth] = useState(0)
  const [page, setPage] = useState(0)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState<"apple" | "google" | null>(null)

  const show = (i: number, animated = !reduced) => {
    setPage(i)
    pager.current?.scrollTo({ x: i * width, animated })
  }
  // Advance once through the slides until the person swipes, then rest on
  // the last one: nothing loops outside Fern. Off with reduced motion.
  // biome-ignore lint/correctness/useExhaustiveDependencies: show is stable enough per render
  useEffect(() => {
    if (reduced || touched || !width || page >= SLIDES.length - 1) return
    const id = setTimeout(() => show(page + 1), 5000)
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
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: safe.top + space.md,
        paddingBottom: safe.bottom + space.lg,
      }}
      bounces={false}
    >
      <Rise i={0} style={{ paddingHorizontal: space.lg, minHeight: 44 }}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Wordmark size={20} />
        </View>
      </Rise>
      <View
        style={{ flexGrow: 1, justifyContent: "center", minHeight: 420 }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <Rise i={1}>
            <ScrollView
              ref={pager}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onScrollBeginDrag={() => setTouched(true)}
              accessibilityLabel="What Unfurl does"
            >
              {SLIDES.map((s, i) => {
                const body = s.body(fern)
                return (
                  <View
                    key={s.title}
                    accessible
                    accessibilityLabel={`${s.title} ${body}`}
                    accessibilityHint={`Slide ${i + 1} of ${SLIDES.length}`}
                    style={{
                      width,
                      paddingHorizontal: space.lg,
                      gap: space.xl,
                    }}
                  >
                    <View
                      importantForAccessibility="no-hide-descendants"
                      accessibilityElementsHidden
                      style={{ height: ART_HEIGHT }}
                    >
                      <SlideArt art={s.art} />
                    </View>
                    <View style={{ gap: space.sm }}>
                      <Text
                        style={{
                          fontFamily: fonts.semibold,
                          fontSize: 28,
                          lineHeight: 34,
                          letterSpacing: -0.4,
                          color: t.text,
                        }}
                      >
                        {s.title}
                      </Text>
                      <Text
                        style={{
                          fontFamily: fonts.body,
                          fontSize: 16,
                          lineHeight: 24,
                          color: t.muted,
                          maxWidth: 380,
                          minHeight: 48,
                        }}
                      >
                        {body}
                      </Text>
                    </View>
                  </View>
                )
              })}
            </ScrollView>
          </Rise>
        )}
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            paddingHorizontal: space.lg,
            marginTop: space.md,
          }}
        >
          {SLIDES.map((s, i) => (
            <PageDot
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
      </View>
      <View
        style={{
          paddingHorizontal: space.lg,
          paddingTop: space.xl,
          width: "100%",
          maxWidth: 460,
          alignSelf: "center",
          gap: space.sm,
        }}
      >
        <Rise i={2}>
          <AuthButton onPress={() => go("/signup")}>Create account</AuthButton>
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
              marginTop: space.md,
              textAlign: "center",
              fontFamily: fonts.body,
              fontSize: 12,
              lineHeight: 17,
              color: t.muted,
            }}
          >
            By continuing you agree to the Terms and Privacy Policy.
            {liveMode
              ? " Your data syncs to your account so it is safe across devices."
              : " Your data stays on this device in the prototype."}
          </Text>
        </Rise>
      </View>
    </ScrollView>
  )
}
