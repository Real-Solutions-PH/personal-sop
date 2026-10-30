import * as Clipboard from "expo-clipboard"
import { LinearGradient } from "expo-linear-gradient"
import {
  BellOff,
  Camera,
  ChevronLeft,
  Copy,
  Image as ImageIcon,
  Info,
  Reply,
  Trash2,
  UserPlus,
  X,
} from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native"
import { Gesture, GestureDetector } from "react-native-gesture-handler"
import Animated, {
  FadeIn,
  FadeInUp,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { back, go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { confirm, Field, Sheet, Toggle } from "../ui"
import { GroupFace, useChatTitle } from "./inbox"
import { Avatar, Bounce, haptic, ProgressCard, VideoMedia } from "./kit"
import { pickMedia } from "./media"
import {
  addMembers,
  type Chat,
  deleteChat,
  ensurePostLive,
  lastMineSeen,
  leaveGroup,
  ME,
  type Message,
  markChatRead,
  noteTyping,
  openChatLive,
  reactTo,
  renameChat,
  sendMessage,
  simulateReply,
  socialStore,
  systemLine,
  timeAgo,
  toggleMute,
  unsend,
  usePerson,
  useTyping,
} from "./store"

const MINE: readonly [string, string] = ["#7a3cf0", "#3d5afe"]
const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "👍"]

function TypingDots() {
  const t = useTheme()
  const reduced = useReducedMotion()
  const dots = [useSharedValue(0), useSharedValue(0), useSharedValue(0)]
  // biome-ignore lint/correctness/useExhaustiveDependencies: start once per mount
  useEffect(() => {
    if (reduced) return
    dots.forEach((d, i) => {
      d.value = withDelay(
        i * 140,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 280 }),
            withTiming(0, { duration: 280 }),
          ),
          -1,
        ),
      )
    })
  }, [reduced])
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 20,
        backgroundColor: t.soft,
      }}
    >
      {dots.map((d, i) => (
        <Dot key={i} v={d} color={t.muted} />
      ))}
    </View>
  )
}
function Dot({ v, color }: { v: { value: number }; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 1], [0.35, 1]),
    transform: [{ translateY: interpolate(v.value, [0, 1], [0, -3]) }],
  }))
  return (
    <Animated.View
      style={[
        { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
        style,
      ]}
    />
  )
}

export function SharedPost({ id }: { id: string }) {
  const t = useTheme()
  const post = socialStore.use((s) => s.posts.find((p) => p.id === id))
  const author = usePerson(post?.by ?? "")
  // A post shared from outside my feed is not loaded yet: fetch it.
  const [gone, setGone] = useState(false)
  useEffect(() => {
    void ensurePostLive(id).then((r) => setGone(r === "gone"))
  }, [id])
  if (!post)
    return gone ? (
      <Text style={{ color: t.muted, fontStyle: "italic", padding: 10 }}>
        Post unavailable
      </Text>
    ) : (
      <View
        accessibilityLabel="Loading post"
        style={{
          width: 220,
          height: 120,
          borderRadius: 18,
          backgroundColor: t.soft,
        }}
      />
    )
  const img = post.media.find((m) => m.kind === "image")
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Post by ${author?.username}`}
      onPress={() => go(`/social/post/${id}`)}
      style={{
        width: 220,
        borderRadius: 18,
        overflow: "hidden",
        // It sits on the page, not inside my coloured bubble: card colours
        // either way, or white text vanishes on the light theme.
        backgroundColor: t.card,
        borderWidth: 1,
        borderColor: t.line,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          padding: 8,
        }}
      >
        <Avatar id={post.by} size={22} ring={false} />
        <Text
          style={{
            color: t.text,
            fontFamily: fonts.semibold,
            fontSize: 13,
          }}
        >
          {author?.username}
        </Text>
      </View>
      {img ? (
        <Image
          source={{ uri: img.uri }}
          style={{ width: 220, height: 260 }}
          accessibilityIgnoresInvertColors
        />
      ) : post.progress ? (
        <ProgressCard
          progress={post.progress}
          width={220}
          height={240}
          compact
        />
      ) : post.media[0]?.kind === "video" ? (
        <VideoMedia
          uri={post.media[0].uri}
          active={false}
          showMute={false}
          style={{ width: 220, height: 260 }}
        />
      ) : null}
      {!!post.caption && (
        <Text
          numberOfLines={2}
          style={{
            color: t.text,
            fontSize: 13,
            padding: 8,
            fontFamily: fonts.body,
          }}
        >
          {post.caption}
        </Text>
      )}
    </Pressable>
  )
}

function StoryRef({ id, mine }: { id: string; mine: boolean }) {
  const t = useTheme()
  const story = socialStore.use((s) => s.stories.find((x) => x.id === id))
  return (
    <View
      style={{
        alignItems: mine ? "flex-end" : "flex-start",
        gap: 4,
        marginBottom: 2,
      }}
    >
      <Text style={{ color: t.muted, fontSize: 12, fontFamily: fonts.body }}>
        {mine ? "You replied to their story" : "Replied to your story"}
      </Text>
      <View style={{ flexDirection: mine ? "row-reverse" : "row", gap: 6 }}>
        <View style={{ width: 3, borderRadius: 2, backgroundColor: t.line }} />
        {story?.uri && story.kind === "image" ? (
          <Image
            source={{ uri: story.uri }}
            style={{ width: 80, height: 140, borderRadius: 10 }}
          />
        ) : story?.progress ? (
          <View style={{ borderRadius: 10, overflow: "hidden" }}>
            <ProgressCard
              progress={story.progress}
              width={80}
              height={140}
              compact
            />
          </View>
        ) : (
          <LinearGradient
            colors={story?.bg ?? ["#333", "#111"]}
            style={{
              width: 80,
              height: 140,
              borderRadius: 10,
              padding: 6,
              justifyContent: "center",
            }}
          >
            <Text
              numberOfLines={5}
              style={{ color: "#fff", fontSize: 9, textAlign: "center" }}
            >
              {story?.text ?? "Story unavailable"}
            </Text>
          </LinearGradient>
        )}
      </View>
    </View>
  )
}

function Row({
  m,
  prev,
  next,
  group,
  replied,
  onReply,
  onLong,
}: {
  m: Message
  prev?: Message
  next?: Message
  group: boolean
  replied?: Message
  onReply: (m: Message) => void
  onLong: (m: Message) => void
}) {
  const t = useTheme()
  const mine = m.by === ME
  const sender = usePerson(m.by)
  const firstOfRun =
    !prev || prev.by !== m.by || m.at - prev.at > 10 * 60_000 || prev.system
  const lastOfRun =
    !next || next.by !== m.by || next.at - m.at > 10 * 60_000 || next.system
  const gap = prev && m.at - prev.at > 60 * 60_000
  const x = useSharedValue(0)
  const armed = useSharedValue(0)
  // Swipe a message toward the middle to reply, like Instagram.
  const pan = Gesture.Pan()
    .activeOffsetX(mine ? [-12, 9999] : [-9999, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const dx = mine
        ? Math.min(0, e.translationX)
        : Math.max(0, e.translationX)
      x.value = Math.sign(dx) * Math.min(Math.abs(dx), 80)
      const on = Math.abs(dx) > 56 ? 1 : 0
      if (on !== armed.value) {
        armed.value = on
        if (on) runOnJS(haptic.tap)()
      }
    })
    .onEnd(() => {
      if (armed.value) runOnJS(onReply)(m)
      armed.value = 0
      x.value = withSpring(0)
    })
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }))
  const hint = useAnimatedStyle(() => ({
    opacity: interpolate(Math.abs(x.value), [10, 56], [0, 1], "clamp"),
    transform: [
      { scale: interpolate(Math.abs(x.value), [10, 56], [0.5, 1], "clamp") },
    ],
  }))
  const reactions = Object.values(m.reactions)
  const radius = 20
  const tight = 6
  if (m.system)
    return (
      <Text
        style={{
          color: t.muted,
          fontSize: 12,
          textAlign: "center",
          paddingVertical: 10,
          fontFamily: fonts.body,
        }}
      >
        {systemLine(m, sender?.name.split(" ")[0] ?? "")}
      </Text>
    )
  return (
    <View>
      {gap && (
        <Text
          style={{
            color: t.muted,
            fontSize: 12,
            textAlign: "center",
            paddingVertical: 12,
            fontFamily: fonts.medium,
          }}
        >
          {new Date(m.at).toLocaleString(undefined, {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })}
        </Text>
      )}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 0,
            bottom: 0,
            justifyContent: "center",
            [mine ? "right" : "left"]: 12,
          },
          hint,
        ]}
      >
        <Reply size={18} color={t.muted} />
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            {
              flexDirection: "row",
              alignItems: "flex-end",
              justifyContent: mine ? "flex-end" : "flex-start",
              gap: 6,
              paddingHorizontal: 12,
              marginTop: firstOfRun ? 8 : 2,
              marginBottom: reactions.length ? 18 : 0,
            },
            slide,
          ]}
        >
          {!mine && (
            <View style={{ width: 28 }}>
              {lastOfRun && (
                <Avatar
                  id={m.by}
                  size={28}
                  ring={false}
                  onPress={() => go(`/social/u/${m.by}`)}
                />
              )}
            </View>
          )}
          <View
            style={{
              maxWidth: "75%",
              alignItems: mine ? "flex-end" : "flex-start",
            }}
          >
            {group && !mine && firstOfRun && (
              <Text
                style={{
                  color: t.muted,
                  fontSize: 12,
                  marginLeft: 12,
                  marginBottom: 2,
                  fontFamily: fonts.body,
                }}
              >
                {sender?.name.split(" ")[0]}
              </Text>
            )}
            {replied && (
              <View
                style={{
                  opacity: 0.8,
                  marginBottom: -8,
                  paddingBottom: 12,
                  paddingHorizontal: 12,
                  paddingTop: 8,
                  borderRadius: 16,
                  backgroundColor: t.soft,
                  maxWidth: 220,
                }}
              >
                <Text
                  numberOfLines={2}
                  style={{
                    color: t.muted,
                    fontSize: 12,
                    fontFamily: fonts.body,
                  }}
                >
                  {replied.text ?? (replied.postId ? "Post" : "Photo")}
                </Text>
              </View>
            )}
            {m.storyReply && <StoryRef id={m.storyReply} mine={mine} />}
            <Pressable
              onLongPress={() => {
                haptic.pop()
                onLong(m)
              }}
              delayLongPress={280}
              accessibilityHint="Long press for reactions and more"
              style={{ gap: 4, alignItems: mine ? "flex-end" : "flex-start" }}
            >
              {m.postId && <SharedPost id={m.postId} />}
              {m.media && (
                <Image
                  source={{ uri: m.media.uri }}
                  style={{ width: 200, height: 260, borderRadius: 18 }}
                  accessibilityLabel="Photo"
                />
              )}
              {!!m.text &&
                (/^\p{Extended_Pictographic}{1,3}$/u.test(m.text) ? (
                  <Text style={{ fontSize: 40 }}>{m.text}</Text>
                ) : mine ? (
                  <LinearGradient
                    colors={MINE}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      borderRadius: radius,
                      borderTopRightRadius: firstOfRun ? radius : tight,
                      borderBottomRightRadius: lastOfRun ? radius : tight,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 15,
                        lineHeight: 20,
                        fontFamily: fonts.body,
                      }}
                    >
                      {m.text}
                    </Text>
                  </LinearGradient>
                ) : (
                  <View
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 9,
                      borderRadius: radius,
                      borderTopLeftRadius: firstOfRun ? radius : tight,
                      borderBottomLeftRadius: lastOfRun ? radius : tight,
                      backgroundColor: t.soft,
                    }}
                  >
                    <Text
                      style={{
                        color: t.text,
                        fontSize: 15,
                        lineHeight: 20,
                        fontFamily: fonts.body,
                      }}
                    >
                      {m.text}
                    </Text>
                  </View>
                ))}
            </Pressable>
            {reactions.length > 0 && (
              <Animated.View
                entering={ZoomIn.springify()}
                style={{
                  position: "absolute",
                  bottom: -16,
                  [mine ? "right" : "left"]: 10,
                  flexDirection: "row",
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 12,
                  backgroundColor: t.card,
                  borderWidth: 2,
                  borderColor: t.bg,
                }}
              >
                <Text style={{ fontSize: 13 }}>
                  {[...new Set(reactions)].join("")}
                  {reactions.length > 1 && (
                    <Text style={{ fontSize: 11, color: t.muted }}>
                      {" "}
                      {reactions.length}
                    </Text>
                  )}
                </Text>
              </Animated.View>
            )}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  )
}

function ActionMenu({
  chatId,
  m,
  onClose,
  onReply,
}: {
  chatId: string
  m: Message | null
  onClose: () => void
  onReply: (m: Message) => void
}) {
  const t = useTheme()
  if (!m) return null
  const mine = m.by === ME
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "#000a",
          justifyContent: "center",
          padding: 24,
          gap: 12,
        }}
      >
        <Animated.View
          entering={ZoomIn.springify().damping(14)}
          style={{
            flexDirection: "row",
            alignSelf: "center",
            gap: 4,
            padding: 8,
            borderRadius: 32,
            backgroundColor: t.card,
          }}
        >
          {REACTIONS.map((e, i) => (
            <Animated.View key={e} entering={FadeInUp.delay(i * 35)}>
              <Pressable
                cssInterop={false}
                accessibilityRole="button"
                accessibilityLabel={`React ${e}`}
                onPress={() => {
                  haptic.tap()
                  reactTo(chatId, m.id, e)
                  onClose()
                }}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor:
                    m.reactions[ME] === e ? t.soft : "transparent",
                  transform: [{ scale: pressed ? 1.35 : 1 }],
                })}
              >
                <Text style={{ fontSize: 26 }}>{e}</Text>
              </Pressable>
            </Animated.View>
          ))}
        </Animated.View>
        {!!m.text && (
          <View
            style={{
              alignSelf: mine ? "flex-end" : "flex-start",
              maxWidth: "80%",
              padding: 12,
              borderRadius: 18,
              backgroundColor: mine ? MINE[1] : t.soft,
            }}
          >
            <Text
              style={{
                color: mine ? "#fff" : t.text,
                fontFamily: fonts.body,
                fontSize: 15,
              }}
            >
              {m.text}
            </Text>
          </View>
        )}
        <Animated.View
          entering={FadeIn.delay(80)}
          style={{
            alignSelf: mine ? "flex-end" : "flex-start",
            width: 220,
            borderRadius: 16,
            backgroundColor: t.card,
            overflow: "hidden",
          }}
        >
          {[
            { label: "Reply", Icon: Reply, run: () => onReply(m) },
            ...(m.text
              ? [
                  {
                    label: "Copy",
                    Icon: Copy,
                    run: () =>
                      void Clipboard.setStringAsync(m.text ?? "").then(() =>
                        toast.success("Copied"),
                      ),
                  },
                ]
              : []),
            ...(mine
              ? [
                  {
                    label: "Unsend",
                    Icon: Trash2,
                    danger: true,
                    run: () => unsend(chatId, m.id),
                  },
                ]
              : []),
          ].map(({ label, Icon, run, ...r }) => (
            <Pressable
              cssInterop={false}
              key={label}
              accessibilityRole="button"
              onPress={() => {
                onClose()
                run()
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingHorizontal: 16,
                minHeight: 48,
                backgroundColor: pressed ? t.soft : "transparent",
                borderBottomWidth: 1,
                borderColor: t.line,
              })}
            >
              <Text
                style={{
                  color: "danger" in r ? t.bad : t.text,
                  fontFamily: fonts.medium,
                  fontSize: 15,
                }}
              >
                {label}
              </Text>
              <Icon size={18} color={"danger" in r ? t.bad : t.text} />
            </Pressable>
          ))}
        </Animated.View>
      </Pressable>
    </Modal>
  )
}

function ChatInfo({
  chat,
  open,
  onClose,
}: {
  chat: Chat
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const people = socialStore.use((s) => s.people)
  const [name, setName] = useState(chat.name ?? "")
  const [adding, setAdding] = useState(false)
  const group = !!chat.name
  const rename = () => {
    const next = name.trim()
    if (next && next !== chat.name) renameChat(chat.id, next)
  }
  return (
    <Sheet
      title={group ? "Group details" : "Details"}
      open={open}
      onClose={onClose}
    >
      {group && (
        <Field
          label="Group name"
          value={name}
          onChangeText={setName}
          // onEndEditing never fires on web; blur and submit do everywhere.
          onBlur={rename}
          onSubmitEditing={rename}
          returnKeyType="done"
        />
      )}
      <Toggle
        label="Mute messages"
        value={chat.muted}
        onChange={() => toggleMute(chat.id)}
      />
      <Text
        style={{
          color: t.muted,
          fontFamily: fonts.medium,
          fontSize: 12,
          marginTop: 12,
          letterSpacing: 0.6,
        }}
      >
        {group ? `MEMBERS · ${chat.members.length + 1}` : "MEMBER"}
      </Text>
      {chat.members.map((id) => {
        const p = people.find((x) => x.id === id)
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            onPress={() => {
              onClose()
              go(`/social/u/${id}`)
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 8,
            }}
          >
            <Avatar id={id} size={44} ring={false} />
            <View>
              <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
                {p?.name}
              </Text>
              <Text
                style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}
              >
                {p?.username}
              </Text>
            </View>
          </Pressable>
        )
      })}
      {group && (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdding((a) => !a)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 10,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <UserPlus size={20} color={t.text} />
            </View>
            <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
              Add people
            </Text>
          </Pressable>
          {adding &&
            people
              .filter((p) => !chat.members.includes(p.id))
              .map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${p.name}`}
                  onPress={() => {
                    addMembers(chat.id, [p.id])
                    // Live mode: the server writes the "added" line itself.
                    if (!liveMode)
                      sendMessage(chat.id, {
                        text: `You added ${p.name}`,
                        system: true,
                      })
                    haptic.tap()
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 6,
                    paddingLeft: 16,
                  }}
                >
                  <Avatar id={p.id} size={36} ring={false} />
                  <Text
                    style={{ color: t.text, fontFamily: fonts.body, flex: 1 }}
                  >
                    {p.name}
                  </Text>
                  <Text style={{ color: t.tsk, fontFamily: fonts.semibold }}>
                    Add
                  </Text>
                </Pressable>
              ))}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          confirm(
            group ? "Leave group?" : "Delete chat?",
            group
              ? "You won't get messages from this group."
              : "This removes the conversation from your inbox.",
            () => {
              onClose()
              if (group) leaveGroup(chat.id)
              else deleteChat(chat.id)
              back("/social/inbox")
            },
          )
        }
        style={{ minHeight: 48, justifyContent: "center", marginTop: 12 }}
      >
        <Text
          style={{ color: t.bad, fontFamily: fonts.semibold, fontSize: 15 }}
        >
          {group ? "Leave group" : "Delete chat"}
        </Text>
      </Pressable>
    </Sheet>
  )
}

export function ChatScreen({ id }: { id: string }) {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const chat = socialStore.use((s) => s.chats.find((c) => c.id === id))
  const title = useChatTitle(chat)
  const first = usePerson(chat?.members[0] ?? "")
  const [text, setText] = useState("")
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [menu, setMenu] = useState<Message | null>(null)
  const [info, setInfo] = useState(false)
  const [simulated, setTyping] = useState<string | null>(null)
  const typing = useTyping(id) ?? simulated
  const input = useRef<TextInputInstance>(null)
  const [opening, setOpening] = useState(true)
  useEffect(() => {
    setOpening(true)
    void openChatLive(id).finally(() => setOpening(false))
    // Back from the background: pick up what arrived while away.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void openChatLive(id)
    })
    return () => sub.remove()
  }, [id])
  const count = chat?.messages.length ?? 0
  // Mark read and drop the typing dots whenever a message lands. Keyed on the
  // count: depending on `chat` would loop, since marking read changes it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (id) markChatRead(id)
    setTyping(null)
  }, [count, id])
  const data = useMemo(
    () => [...(chat?.messages ?? [])].reverse(),
    [chat?.messages],
  )
  if (!chat)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: t.bg,
          paddingTop: safe.top,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {opening ? (
          <ActivityIndicator accessibilityLabel="Loading chat" />
        ) : (
          <Text style={{ color: t.muted }}>This chat no longer exists.</Text>
        )}
      </View>
    )
  const group = !!chat.name
  const lastMine = chat.messages.findLast((m) => m.by === ME && !m.system)
  const seen = lastMineSeen(chat)
  const send = (body: Partial<Message>) => {
    sendMessage(chat.id, { ...body, replyTo: replyTo?.id })
    haptic.tap()
    setText("")
    setReplyTo(null)
    const who = simulateReply(chat.id, 2200)
    if (who) setTimeout(() => setTyping(who), 700)
  }
  const sendPhoto = async () => {
    const [m] = await pickMedia({ multiple: false, video: false })
    if (m) send({ media: m })
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}
    >
      <View
        style={{
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 4,
          borderBottomWidth: 1,
          borderColor: t.line,
        }}
      >
        <Bounce
          label="Back"
          onPress={() => back("/social/inbox")}
          style={{ width: 40 }}
        >
          <ChevronLeft size={26} color={t.text} />
        </Bounce>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            group ? "Group details" : `Open ${title}'s profile`
          }
          onPress={() =>
            group ? setInfo(true) : go(`/social/u/${chat.members[0]}`)
          }
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <GroupFace chat={chat} size={36} />
          <View style={{ flex: 1 }}>
            <Text
              numberOfLines={1}
              style={{
                color: t.text,
                fontFamily: fonts.semibold,
                fontSize: 16,
              }}
            >
              {title}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 12 }}
            >
              {group
                ? `${chat.members.length + 1} members`
                : typing
                  ? "typing…"
                  : `${first?.username} · Active ${timeAgo(Date.now() - 4 * 60_000)} ago`}
            </Text>
          </View>
          {chat.muted && <BellOff size={14} color={t.muted} />}
        </Pressable>
        <Bounce label="Details" onPress={() => setInfo(true)}>
          <Info size={22} color={t.text} />
        </Bounce>
      </View>
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        ListHeaderComponent={
          <View style={{ paddingTop: 8 }}>
            {typing && (
              <Animated.View
                entering={FadeIn}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 6,
                  paddingHorizontal: 12,
                  marginTop: 8,
                }}
              >
                <Avatar id={typing} size={28} ring={false} />
                <TypingDots />
              </Animated.View>
            )}
            {!typing &&
              lastMine &&
              chat.messages[chat.messages.length - 1]?.id === lastMine.id && (
                <Text
                  style={{
                    color: t.muted,
                    fontSize: 12,
                    textAlign: "right",
                    paddingHorizontal: 16,
                    paddingTop: 2,
                    fontFamily: fonts.body,
                  }}
                >
                  {seen ? "Seen" : "Sent"}
                </Text>
              )}
          </View>
        }
        ListFooterComponent={
          <View style={{ alignItems: "center", gap: 6, paddingVertical: 24 }}>
            {opening && (
              <ActivityIndicator
                accessibilityLabel="Loading messages"
                style={{ marginBottom: 12 }}
              />
            )}
            <GroupFace chat={chat} size={88} />
            <Text
              style={{ color: t.text, fontFamily: fonts.display, fontSize: 22 }}
            >
              {title}
            </Text>
            {!group && first && (
              <>
                <Text style={{ color: t.muted, fontFamily: fonts.body }}>
                  {first.username} · Unfurl
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => go(`/social/u/${first.id}`)}
                  style={{
                    marginTop: 6,
                    paddingHorizontal: 14,
                    minHeight: 36,
                    borderRadius: 10,
                    justifyContent: "center",
                    backgroundColor: t.soft,
                  }}
                >
                  <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
                    View profile
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        }
        renderItem={({ item, index }) => (
          // Only messages that land after the history loads animate in.
          <Animated.View
            entering={opening ? undefined : FadeInUp.duration(200)}
          >
            <Row
              m={item}
              prev={data[index + 1]}
              next={data[index - 1]}
              group={group}
              replied={
                item.replyTo
                  ? chat.messages.find((x) => x.id === item.replyTo)
                  : undefined
              }
              onReply={(m) => {
                setReplyTo(m)
                input.current?.focus()
              }}
              onLong={setMenu}
            />
          </Animated.View>
        )}
      />
      {replyTo && (
        <Animated.View
          entering={FadeInUp}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderTopWidth: 1,
            borderColor: t.line,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: t.text,
                fontFamily: fonts.semibold,
                fontSize: 13,
              }}
            >
              Replying to{" "}
              {replyTo.by === ME
                ? "yourself"
                : replyTo.by === first?.id
                  ? first?.name.split(" ")[0]
                  : "message"}
            </Text>
            <Text
              numberOfLines={1}
              style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13 }}
            >
              {replyTo.text ?? "Attachment"}
            </Text>
          </View>
          <Bounce label="Cancel reply" onPress={() => setReplyTo(null)}>
            <X size={18} color={t.muted} />
          </Bounce>
        </Animated.View>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          margin: 10,
          marginBottom: Math.max(safe.bottom, 10),
          padding: 4,
          borderRadius: 26,
          backgroundColor: t.soft,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send a photo"
          onPress={() => void sendPhoto()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: t.tsk,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Camera size={20} color="#fff" />
        </Pressable>
        <TextInput
          ref={input}
          value={text}
          onChangeText={(v) => {
            setText(v)
            if (v) noteTyping(chat.id)
          }}
          placeholder="Message…"
          placeholderTextColor={t.muted}
          accessibilityLabel="Message"
          multiline
          style={{
            flex: 1,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 15,
            maxHeight: 120,
            paddingVertical: 10,
          }}
        />
        {text.trim() ? (
          <Animated.View entering={ZoomIn.duration(150)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              onPress={() => send({ text: text.trim() })}
              style={{
                height: 40,
                paddingHorizontal: 14,
                justifyContent: "center",
              }}
            >
              <Text
                style={{ color: t.tsk, fontFamily: fonts.bold, fontSize: 15 }}
              >
                Send
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={{ flexDirection: "row" }}>
            <Bounce label="Choose photo" onPress={() => void sendPhoto()}>
              <ImageIcon size={22} color={t.text} />
            </Bounce>
            <Bounce label="Send heart" onPress={() => send({ text: "❤️" })}>
              <Text style={{ fontSize: 22 }}>❤️</Text>
            </Bounce>
          </View>
        )}
      </View>
      <ActionMenu
        chatId={chat.id}
        m={menu}
        onClose={() => setMenu(null)}
        onReply={(m) => {
          setReplyTo(m)
          input.current?.focus()
        }}
      />
      <ChatInfo chat={chat} open={info} onClose={() => setInfo(false)} />
    </KeyboardAvoidingView>
  )
}
