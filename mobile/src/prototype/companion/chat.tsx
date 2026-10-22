import { captureStore } from "@domain/capture/store"
import * as D from "@domain/dash/hooks"
import { dashStore } from "@domain/dash/store"
import { captureUi, closeCapture } from "@domain/lib/capture"
import { dayKey, dayOffset } from "@domain/lib/day"
import { useLocalSearchParams, usePathname } from "expo-router"
import {
  BarChart3,
  Brain,
  CalendarCheck2,
  Clock,
  Copy,
  Image as ImageIcon,
  Lightbulb,
  Maximize2,
  MessagesSquare,
  Pause,
  PenLine,
  Settings2,
  Target,
  Volume2,
} from "lucide-react-native"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { stopSpeech, speaking as useSpeaking } from "@/live/speech"
import { stopDictation } from "../live-dictation"
import { copyText } from "../media"
import { feel } from "../motion"
import { IconTap, Line } from "../native-kit"
import { go } from "../navigation"
import { Exchange, ThreadComposer } from "../screens/capture-thread"
import { fonts, useTheme } from "../theme"
import { Screen } from "../ui"
import { wake } from "../wake-word"
import { AskStatus } from "./ask-status"
import { BlockView, Chips, TrackerCard } from "./blocks"
import { ask } from "./brain"
import { ChatsSheet } from "./chats"
import { Orb } from "./orb"
import {
  chatList,
  chatMessages,
  companionStore,
  currentThread,
  type Msg,
  thinking,
} from "./store"

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? "Morning" : h < 18 ? "Afternoon" : "Evening"
}

export function SolMessage({ m, name }: { m: Msg; name: string }) {
  const t = useTheme()
  // While a reply streams, the model's line breaks between tool calls arrive
  // before any words; blank lines must not open a gap above the steps.
  const text = m.text?.trim() ?? ""
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18)}
      style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}
    >
      <View style={{ marginTop: 2 }}>
        <Orb size={26} />
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text
          style={{ color: t.muted, fontFamily: fonts.semibold, fontSize: 11 }}
        >
          {name}
        </Text>
        {!!text && (
          <Text
            style={{
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 21,
            }}
          >
            {text}
          </Text>
        )}
        {m.blocks?.map((b, i) => (
          <BlockView key={i} block={b} />
        ))}
        {!!text && <ReplyActions id={m.id} text={text} />}
      </View>
    </Animated.View>
  )
}
/** Under a reply: read it aloud (play / pause) and copy it. */
function ReplyActions({ id, text }: { id: string; text: string }) {
  const t = useTheme()
  const now = useSpeaking((s) => (s.id === id ? s.state : "idle"))
  const toggle = () => {
    const sp = require("@/live/speech") as typeof import("@/live/speech")
    const { http } = require("@/live/auth") as typeof import("@/live/auth")
    sp.toggleSpeech(id, { http }).catch((e: unknown) =>
      toast(
        e instanceof sp.SpeechError && e.code === "unavailable"
          ? "Read aloud isn't set up on the server yet."
          : "Couldn't read that aloud. Try again.",
      ),
    )
  }
  return (
    <Line style={{ gap: 4, marginLeft: -8 }}>
      {liveMode &&
        (now === "loading" ? (
          <View
            accessibilityLabel="Preparing audio"
            style={{
              width: 36,
              height: 36,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator size="small" color={t.muted} />
          </View>
        ) : (
          <IconTap
            size={36}
            icon={now === "playing" ? Pause : Volume2}
            label={now === "playing" ? "Pause reading" : "Read aloud"}
            color={now === "idle" ? t.muted : t.primary}
            onPress={toggle}
          />
        ))}
      <IconTap
        size={36}
        icon={Copy}
        label="Copy reply"
        color={t.muted}
        onPress={() => void copyText(text)}
      />
    </Line>
  )
}
function MyMessage({ m }: { m: Msg }) {
  const t = useTheme()
  const photos = m.blocks?.find((b) => b.t === "photos")
  const shots =
    photos && photos.t === "photos"
      ? (photos.urls ?? photos.media ?? []).map((u, i) => ({
          url: photos.urls?.[i] ?? null,
          media: photos.media?.[i],
          key: `${i}-${u ?? ""}`,
        }))
      : []
  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      style={{ alignItems: "flex-end", gap: 6 }}
    >
      {shots.length > 0 && (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "flex-end",
            gap: 6,
            maxWidth: "85%",
          }}
        >
          {shots.map((p) => (
            <SentPhoto key={p.key} url={p.url} media={p.media} />
          ))}
        </View>
      )}
      {!!m.text && (
        <View
          style={{
            maxWidth: "85%",
            backgroundColor: t.primary,
            borderRadius: 18,
            borderBottomRightRadius: 6,
            paddingHorizontal: 14,
            paddingVertical: 9,
          }}
        >
          <Text
            style={{
              color: t.onPrimary,
              fontFamily: fonts.body,
              fontSize: 15,
              lineHeight: 20,
            }}
          >
            {m.text}
          </Text>
        </View>
      )}
      <AskStatus m={m} />
    </Animated.View>
  )
}
/** A photo sent with a message. Messages read back through sync carry
 * only the photo's id, so its link is fetched when it is shown. */
function SentPhoto({ url, media }: { url: string | null; media?: string }) {
  const t = useTheme()
  const [src, setSrc] = useState(url)
  useEffect(() => {
    if (src || !media || !liveMode) return
    const { http } = require("@/live/auth") as typeof import("@/live/auth")
    http
      .request<{ url?: string | null }>("GET", `/media/${media}`)
      .then((r) => r.url && setSrc(r.url))
      .catch(() => {})
  }, [src, media])
  return (
    <View
      style={{
        width: 96,
        height: 96,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: t.soft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          accessibilityLabel="Sent photo"
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <ImageIcon size={22} color={t.muted} />
      )}
    </View>
  )
}
function Thinking({ name }: { name: string }) {
  const t = useTheme()
  const on = thinking((s) => s.on)
  if (!on) return null
  return (
    <Animated.View
      entering={FadeIn}
      style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
    >
      <Orb size={26} active />
      <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 13 }}>
        {name} is thinking…
      </Text>
    </Animated.View>
  )
}

const NO_CAPTURES: ReturnType<typeof captureStore.get>["captures"] = []

/** Companion messages and captures interleaved by time. */
function useTimeline(since = 0) {
  // The chat on screen; entries logged outside chat show in the most
  // recent chat only, not in every one.
  const store = companionStore.use((s) => s)
  const messages = useMemo(() => chatMessages(store), [store])
  // Entries logged outside chat show in the most recent chat, from when
  // it began: a new chat starts clean.
  const capturesFrom = useMemo(() => {
    const first = chatList(store)[0]
    if (!first) return 0
    return currentThread(store) === first.id ? first.createdAt : null
  }, [store])
  const allCaptures = captureStore.use((s) => s.captures)
  const captures = useMemo(
    () =>
      capturesFrom === null
        ? NO_CAPTURES
        : allCaptures.filter((c) => new Date(c.at).getTime() >= capturesFrom),
    [allCaptures, capturesFrom],
  )
  return useMemo(() => {
    const items: {
      at: number
      key: string
      node: { kind: "msg"; m: Msg } | { kind: "cap"; id: string }
    }[] = [
      ...messages
        .filter((m) => m.at >= since)
        .map((m) => ({
          at: m.at,
          key: m.id,
          node: { kind: "msg" as const, m },
        })),
      ...captures
        // Fern's own writes show as steps in its reply (ADR-0015).
        .filter((c) => c.source !== "chat")
        .filter((c) => new Date(c.at).getTime() >= since)
        .map((c) => ({
          at: new Date(c.at).getTime(),
          key: c.id,
          node: { kind: "cap" as const, id: c.id },
        })),
    ]
    return items.sort((a, b) => a.at - b.at)
  }, [messages, captures, since])
}
function TimelineItem({
  node,
  name,
}: {
  node: ReturnType<typeof useTimeline>[number]["node"]
  name: string
}) {
  const cap = captureStore.use((s) =>
    node.kind === "cap" ? s.captures.find((c) => c.id === node.id) : undefined,
  )
  if (node.kind === "cap") return cap ? <Exchange cap={cap} /> : null
  return node.m.role === "me" ? (
    <MyMessage m={node.m} />
  ) : (
    <SolMessage m={node.m} name={name} />
  )
}

const CAPABILITIES = [
  {
    icon: PenLine,
    label: "Capture",
    body: "Log meals, money, workouts — in plain words",
    prompt: "ran 5k in 30 min and spent 250 on lunch",
  },
  {
    icon: Lightbulb,
    label: "Insights",
    body: "Patterns from your past records",
    prompt: "How am I doing?",
  },
  {
    icon: BarChart3,
    label: "Charts",
    body: "Visualize anything you track",
    prompt: "Show my spending this month",
  },
  {
    icon: Brain,
    label: "Coach",
    body: "Honest feedback and a next step",
    prompt: "Coach me",
  },
  {
    icon: Target,
    label: "Track",
    body: "Keep an eye on what matters",
    prompt: "Track spending under 1500 a day",
  },
  {
    icon: CalendarCheck2,
    label: "Plan",
    body: "Turn today into a short list",
    prompt: "Plan my day",
  },
]
function Welcome({
  name,
  compact = false,
}: {
  name: string
  compact?: boolean
}) {
  const t = useTheme()
  const me = dashStore.use((s) => s.profile.name.split(" ")[0])
  const ring = D.useTodayRing()
  const left = Math.max(0, ring.due - ring.done)
  return (
    <View
      style={{
        gap: 14,
        alignItems: compact ? "stretch" : "center",
        paddingTop: compact ? 0 : 16,
      }}
    >
      {!compact && <Orb size={72} />}
      <Text
        style={{
          color: t.text,
          fontFamily: fonts.display,
          fontSize: compact ? 22 : 28,
          textAlign: compact ? "left" : "center",
        }}
      >
        {greeting()}, {me}. I'm {name}.
      </Text>
      <Text
        style={{
          color: t.muted,
          fontFamily: fonts.body,
          fontSize: 14,
          lineHeight: 20,
          textAlign: compact ? "left" : "center",
          maxWidth: 340,
        }}
      >
        {left
          ? `${left} thing${left === 1 ? "" : "s"} left today. Tell me what happened or ask me anything; I keep track of your habits, money and training.`
          : "Today's plan is done. Steady work. Want a recap, or a look at tomorrow?"}
      </Text>
      {/* Cards go in rows of two; each row stretches both cards to the
          taller one, so a row never has a short card beside a long one. */}
      <View style={{ gap: 8, alignSelf: "stretch" }}>
        {pairs(CAPABILITIES).map((row, r) => (
          <View
            key={row[0].label}
            style={{ flexDirection: "row", gap: 8, alignItems: "stretch" }}
          >
            {row.map((c, j) => (
              <Animated.View
                key={c.label}
                entering={FadeInDown.delay(60 * (r * 2 + j))}
                style={{ flex: 1 }}
              >
                <Pressable
                  cssInterop={false}
                  accessibilityRole="button"
                  accessibilityLabel={`${c.label}. ${c.body}`}
                  onPress={() => ask(c.prompt)}
                  style={({ pressed }) => ({
                    flex: 1,
                    padding: 12,
                    gap: 4,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: t.line,
                    backgroundColor: pressed ? t.soft : t.card,
                    minHeight: 92,
                  })}
                >
                  <c.icon size={18} color={t.hab} />
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: fonts.semibold,
                      fontSize: 14,
                    }}
                  >
                    {c.label}
                  </Text>
                  <Text
                    style={{
                      color: t.muted,
                      fontFamily: fonts.body,
                      fontSize: 12,
                      lineHeight: 16,
                    }}
                  >
                    {c.body}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
            {row.length === 1 && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
    </View>
  )
}

function pairs<T>(xs: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += 2) out.push(xs.slice(i, i + 2))
  return out
}

function DaySeparator({ day }: { day: string }) {
  const t = useTheme()
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ height: 1, flex: 1, backgroundColor: t.line }} />
      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 11 }}>
        {day === dayKey()
          ? "Today"
          : day === dayOffset(-1)
            ? "Yesterday"
            : new Date(`${day}T12:00:00`).toLocaleDateString("en-PH", {
                month: "short",
                day: "numeric",
              })}
      </Text>
      <View style={{ height: 1, flex: 1, backgroundColor: t.line }} />
    </View>
  )
}

/** The full companion chat page. */
/** Stop Fern's voice and the live mic (the chat is closing). */
function silenceChat() {
  stopSpeech()
  stopDictation()
}

export function CompanionChat() {
  const t = useTheme()
  // Leaving the full chat page silences it, like closing the drawer.
  useEffect(() => () => silenceChat(), [])
  const name = companionStore.use((s) => s.name)
  const trackers = companionStore.use((s) => s.trackers)
  const timeline = useTimeline()
  const params = useLocalSearchParams<{ q?: string; hint?: string }>()
  const on = thinking((s) => s.on)
  const onPage = usePathname() === "/capture"
  const drawerOpen = captureUi.use((s) => s.open)
  const armed = wake((s) => s.armed)
  const inset = useSafeAreaInsets()
  const keyboardUp = useKeyboardUp()
  const [chats, setChats] = useState(false)
  let lastDay = ""
  return (
    <Screen
      title={name}
      scrollToEnd
      titleContent={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Orb size={34} active={on} />
          <View>
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.displayMedium,
                fontSize: 20,
                lineHeight: 24,
              }}
            >
              {name}
            </Text>
            <Text
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}
            >
              {on
                ? "thinking…"
                : armed
                  ? `Say “Hey ${name}” to talk`
                  : "Your life companion"}
            </Text>
          </View>
        </View>
      }
      actions={
        <View style={{ flexDirection: "row" }}>
          <IconTap
            size={44}
            icon={MessagesSquare}
            label="Chats"
            color={t.text}
            onPress={() => setChats(true)}
          />
          <IconTap
            size={44}
            icon={Clock}
            label="Capture history"
            color={t.text}
            onPress={() => go("/capture/history")}
          />
          <IconTap
            size={44}
            icon={Settings2}
            label="Companion settings"
            color={t.text}
            onPress={() => go("/capture/settings")}
          />
        </View>
      }
      footer={
        // The page hides the tab bar, so the composer clears the home
        // indicator itself; over the keyboard it needs no extra room.
        <View
          style={{
            backgroundColor: t.bg,
            paddingBottom: keyboardUp ? 0 : Math.max(0, inset.bottom - 12),
          }}
        >
          <ThreadComposer
            onText={(v, hint, photos) => ask(v, hint, photos)}
            initialText={params.q ?? ""}
            initialHint={params.hint}
            placeholder={`Message ${name}…`}
            wakeTarget={onPage && !drawerOpen}
          />
        </View>
      }
    >
      {trackers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
          style={{ marginHorizontal: -16, paddingHorizontal: 16, flexGrow: 0 }}
        >
          {trackers.map((tr) => (
            <View key={tr.id} style={{ width: 250 }}>
              <TrackerCard id={tr.id} compact />
            </View>
          ))}
        </ScrollView>
      )}
      <View style={{ gap: 18, paddingVertical: 12 }}>
        {timeline.length === 0 ? (
          <Welcome name={name} />
        ) : (
          timeline.map((x) => {
            const day = dayKey(new Date(x.at))
            const sep = day !== lastDay
            lastDay = day
            return (
              <View key={x.key} style={{ gap: 18 }}>
                {sep && <DaySeparator day={day} />}
                <TimelineItem node={x.node} name={name} />
              </View>
            )
          })
        )}
        <Thinking name={name} />
        {timeline.length > 0 && !on && (
          <Chips prompts={["How am I doing?", "Coach me", "Plan my day"]} />
        )}
      </View>
      <ChatsSheet open={chats} onClose={() => setChats(false)} />
    </Screen>
  )
}

/** Whether the on-screen keyboard is up (iOS says so as it starts moving,
 * Android once it has shown). */
function useKeyboardUp() {
  const [up, setUp] = useState(false)
  useEffect(() => {
    const ios = Platform.OS === "ios"
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      () => setUp(true),
    )
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => setUp(false),
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return up
}

/** Room under the composer for the tab bar's Fern button, which rises about
 * 20 pt above the bar with its ring. The composer already ends in 12 pt of
 * padding, so 12 more keeps the text box about 7 pt clear of the button.
 * (It was 30, which left an empty band under the composer.) */
const FAB_RISE = 12

/**
 * Drawer that rises from the + button. Drag it down to close, or drag it up
 * to grow it to full screen and land in the full chat.
 */
export function CompanionDrawer({ bottom }: { bottom: number }) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const { height: screen } = useWindowDimensions()
  const open = captureUi.use((s) => s.open)
  const ctx = captureUi.use((s) => s.ctx)
  const name = companionStore.use((s) => s.name)
  const on = thinking((s) => s.on)
  const armed = wake((s) => s.armed)
  const [mounted, setMounted] = useState(open)
  const [since, setSince] = useState(Date.now())
  const area = screen - bottom
  const base = Math.min(area - safe.top - 24, Math.max(460, area * 0.66))
  const y = useSharedValue(base)
  const grow = useSharedValue(0)
  const scroller = useRef<ScrollView>(null)
  const timeline = useTimeline(since)
  const [typing, setTyping] = useState(false)
  // The keyboard's height, tracked directly: a KeyboardAvoidingView inside
  // this absolutely placed, transformed sheet measured itself wrong and never
  // lifted the composer on a phone. iOS reports the keyboard as it starts to
  // move; Android only once it has shown.
  const [keyboard, setKeyboard] = useState(0)
  useEffect(() => {
    const ios = Platform.OS === "ios"
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      (e) => {
        setTyping(true)
        setKeyboard(e.endCoordinates.height)
      },
    )
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setTyping(false)
        setKeyboard(0)
      },
    )
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: open/close only
  useEffect(() => {
    if (open) {
      setSince(Date.now())
      setMounted(true)
      grow.value = 0
      y.value = base
      y.value = reduced
        ? 0
        : withSpring(0, { damping: 22, stiffness: 210, mass: 0.9 })
    } else if (mounted) {
      if (reduced) setMounted(false)
      else
        y.value = withTiming(
          base,
          { duration: 220, easing: Easing.in(Easing.cubic) },
          (done) => {
            if (done) runOnJS(setMounted)(false)
          },
        )
    }
  }, [open])
  // Closing the chat silences it: Fern stops reading aloud and the mic
  // stops listening, so nothing keeps talking or recording on another page.
  // Expanding to the full chat also closes the drawer; that one keeps going.
  const expanding = useRef(false)
  useEffect(() => {
    if (open) return
    if (expanding.current) expanding.current = false
    else silenceChat()
  }, [open])
  useEffect(() => () => silenceChat(), [])
  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeCapture()
      return true
    })
    return () => sub.remove()
  }, [open])
  const expand = () => {
    feel.success()
    go("/capture")
    // Let the chat page mount underneath, then drop the drawer.
    setTimeout(() => {
      expanding.current = true
      closeCapture()
    }, 260)
  }
  const drag = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY >= 0) {
        y.value = e.translationY
        grow.value = 0
      } else {
        y.value = 0
        grow.value = Math.min(1, -e.translationY / (area - base + 1))
      }
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 900) runOnJS(closeCapture)()
      else if (e.translationY < -90 || e.velocityY < -900) {
        grow.value = withTiming(
          1,
          { duration: 220, easing: Easing.out(Easing.cubic) },
          () => runOnJS(expand)(),
        )
      } else {
        y.value = withSpring(0, { damping: 20 })
        grow.value = withSpring(0, { damping: 20 })
      }
    })
  const sheet = useAnimatedStyle(() => ({
    height: base + (area - base) * grow.value,
    borderTopLeftRadius: 28 * (1 - grow.value),
    borderTopRightRadius: 28 * (1 - grow.value),
    transform: [
      { translateY: y.value },
      { scale: interpolate(y.value, [0, base], [1, 0.94], "clamp") },
    ],
  }))
  const backdrop = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, base], [1, 0], "clamp"),
  }))
  if (!mounted) return null
  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, top: 0, bottom }}
    >
      <Animated.View
        style={[
          { position: "absolute", inset: 0, backgroundColor: "#000a" },
          backdrop,
        ]}
      >
        <Pressable
          accessibilityLabel={`Close ${name}`}
          style={{ flex: 1 }}
          onPress={closeCapture}
        />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[
          {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: t.bg,
            overflow: "hidden",
            boxShadow: "0px -8px 30px #0000004d",
          },
          sheet,
        ]}
      >
        <View
          testID="companion-drawer-body"
          style={{
            flex: 1,
            // The sheet ends at the tab bar; the keyboard rises from the
            // screen's bottom, so only the part above the bar needs room.
            paddingBottom: Math.max(0, keyboard - bottom),
          }}
        >
          <GestureDetector gesture={drag}>
            <View
              collapsable={false}
              style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 8 }}
            >
              <View
                style={{
                  alignSelf: "center",
                  width: 40,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: t.line,
                }}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 10,
                }}
              >
                <Orb size={36} active={on} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: t.text,
                      fontFamily: fonts.displayMedium,
                      fontSize: 20,
                      lineHeight: 24,
                    }}
                  >
                    {name}
                  </Text>
                  <Text
                    style={{
                      color: t.muted,
                      fontFamily: fonts.body,
                      fontSize: 12,
                    }}
                  >
                    {on
                      ? "thinking…"
                      : armed
                        ? `Say “Hey ${name}” to talk`
                        : "Drag up for the full chat"}
                  </Text>
                </View>
                <IconTap
                  size={40}
                  icon={Maximize2}
                  label="Open full chat"
                  color={t.text}
                  onPress={expand}
                />
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            ref={scroller}
            keyboardShouldPersistTaps="handled"
            // Follow the conversation down; a new chat's welcome stays at
            // its top so the greeting is not scrolled out of view.
            onContentSizeChange={() => {
              if (timeline.length)
                scroller.current?.scrollToEnd({ animated: true })
            }}
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 4,
              paddingBottom: 12,
              gap: 16,
            }}
          >
            {timeline.length === 0 ? (
              <Welcome name={name} compact />
            ) : (
              timeline.map((x) => (
                <TimelineItem key={x.key} node={x.node} name={name} />
              ))
            )}
            <Thinking name={name} />
          </ScrollView>
          <ThreadComposer
            onText={(v, hint, photos) => ask(v, hint, photos)}
            hints={false}
            initialHint={ctx.hint}
            initialMode={ctx.mode}
            placeholder={`Message ${name}…`}
            wakeTarget={open}
          />
          {/* The tab bar's + button rises 23 pt above the bar (plus its
              shadow) into the sheet; keep the composer clear of it. The
              keyboard covers the bar, so the room is not needed then. */}
          {bottom > 0 && !typing && <View style={{ height: FAB_RISE }} />}
        </View>
      </Animated.View>
    </View>
  )
}
export type { ReactNode }
