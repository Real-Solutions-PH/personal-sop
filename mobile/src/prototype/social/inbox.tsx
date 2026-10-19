import { useLocalSearchParams } from "expo-router"
import {
  BellOff,
  Camera,
  Check,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
  Users,
} from "lucide-react-native"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native"
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable"
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  ZoomIn,
} from "react-native-reanimated"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { toast } from "sonner-native"
import { go, replace } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Sheet, undo } from "../ui"
import { Avatar, Bounce, haptic, LikeHeart } from "./kit"
import { TopBar } from "./post"
import {
  type Chat,
  clearNote,
  createGroup,
  deleteChat,
  directChat,
  ME,
  type Note,
  searchLive,
  sendMessage,
  setNote,
  simulateReply,
  socialStore,
  timeAgo,
  toggleMute,
  toggleNoteLike,
  togglePin,
  unread,
  useMe,
  usePerson,
} from "./store"

export function GroupFace({ chat, size = 52 }: { chat: Chat; size?: number }) {
  const t = useTheme()
  if (!chat.name || chat.members.length < 2)
    return <Avatar id={chat.members[0]} size={size} />
  const s = size * 0.72
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <Avatar id={chat.members[0]} size={s} ring={false} />
      </View>
      <View
        style={{
          position: "absolute",
          right: 0,
          bottom: 0,
          borderRadius: s,
          borderWidth: 2,
          borderColor: t.bg,
        }}
      >
        <Avatar id={chat.members[1]} size={s} ring={false} />
      </View>
    </View>
  )
}

export function useChatTitle(chat?: Chat) {
  const people = socialStore.use((s) => s.people)
  if (!chat) return ""
  if (chat.name) return chat.name
  return chat.members
    .map((m) => people.find((p) => p.id === m)?.name ?? m)
    .join(", ")
}

function preview(chat: Chat, people: { id: string; name: string }[]) {
  const last = chat.messages[chat.messages.length - 1]
  if (!last) return "Say hi 👋"
  const who =
    last.by === ME
      ? "You: "
      : chat.name
        ? `${people.find((p) => p.id === last.by)?.name.split(" ")[0]}: `
        : ""
  const body = last.postId
    ? "Sent a post"
    : last.storyReply
      ? last.by === ME
        ? `Replied to their story: ${last.text}`
        : `Replied to your story: ${last.text}`
      : last.media
        ? "Sent a photo"
        : (last.text ?? "")
  return last.system ? body : who + body
}

function ChatRow({ chat }: { chat: Chat }) {
  const t = useTheme()
  const people = socialStore.use((s) => s.people)
  const title = useChatTitle(chat)
  const ref = useRef<React.ComponentRef<typeof Swipeable>>(null)
  const n = unread(chat)
  const last = chat.messages[chat.messages.length - 1]
  const action = (
    label: string,
    Icon: typeof Pin,
    bg: string,
    run: () => void,
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        ref.current?.close()
        haptic.tap()
        run()
      }}
      style={{
        width: 76,
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <Icon size={20} color="#fff" />
      <Text style={{ color: "#fff", fontSize: 11, fontFamily: fonts.semibold }}>
        {label}
      </Text>
    </Pressable>
  )
  return (
    <Swipeable
      ref={ref}
      friction={1.6}
      overshootRight={false}
      overshootLeft={false}
      renderLeftActions={() =>
        action(
          chat.pinned ? "Unpin" : "Pin",
          chat.pinned ? PinOff : Pin,
          t.tsk,
          () => togglePin(chat.id),
        )
      }
      renderRightActions={() => (
        <View style={{ flexDirection: "row" }}>
          {action(chat.muted ? "Unmute" : "Mute", BellOff, t.muted, () =>
            toggleMute(chat.id),
          )}
          {action("Delete", Trash2, t.bad, () => {
            const restore = deleteChat(chat.id)
            undo("Chat deleted", restore)
          })}
        </View>
      )}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}${n ? `, ${n} unread` : ""}`}
        onPress={() => go(`/social/chat/${chat.id}`)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 9,
          backgroundColor: pressed ? t.soft : t.bg,
        })}
      >
        <GroupFace chat={chat} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              color: t.text,
              fontFamily: n ? fonts.bold : fonts.medium,
              fontSize: 15,
            }}
          >
            {title}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              color: n ? t.text : t.muted,
              fontFamily: n ? fonts.semibold : fonts.body,
              fontSize: 13,
            }}
          >
            {preview(chat, people)}
            {last && (
              <Text style={{ color: t.muted, fontFamily: fonts.body }}>
                {" "}
                · {timeAgo(last.at)}
              </Text>
            )}
          </Text>
        </View>
        {chat.pinned && <Pin size={14} color={t.muted} />}
        {chat.muted && <BellOff size={14} color={t.muted} />}
        {n > 0 && !chat.muted ? (
          <Animated.View
            entering={ZoomIn}
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: t.tsk,
            }}
          />
        ) : (
          <Camera size={22} color={t.muted} />
        )}
      </Pressable>
    </Swipeable>
  )
}

function Bubble({ text, mine }: { text?: string; mine?: boolean }) {
  const t = useTheme()
  return (
    <View
      style={{
        position: "absolute",
        top: -6,
        left: -6,
        right: -6,
        alignItems: "center",
        zIndex: 2,
      }}
    >
      <View
        style={{
          backgroundColor: t.card,
          borderRadius: 14,
          paddingHorizontal: 10,
          paddingVertical: 6,
          maxWidth: 96,
          borderWidth: 1,
          borderColor: t.line,
          boxShadow: "0px 2px 8px #0002",
        }}
      >
        <Text
          numberOfLines={2}
          style={{
            color: text ? t.text : t.muted,
            fontSize: 11,
            lineHeight: 14,
            fontFamily: fonts.body,
            textAlign: "center",
          }}
        >
          {text ?? (mine ? "Note…" : "")}
        </Text>
      </View>
    </View>
  )
}

function NoteViewer({
  note,
  onClose,
}: {
  note: Note | null
  onClose: () => void
}) {
  const t = useTheme()
  const person = usePerson(note?.by ?? "")
  const [reply, setReply] = useState("")
  const fresh = socialStore.use((s) => s.notes.find((n) => n.by === note?.by))
  if (!note || !person) return null
  const send = () => {
    if (!reply.trim()) return
    const chat = directChat(note.by)
    sendMessage(chat, {
      text: `Replied to your note "${note.text}": ${reply.trim()}`,
    })
    simulateReply(chat)
    toast.success(`Sent to ${person.username}`)
    setReply("")
    onClose()
  }
  return (
    <Sheet title={person.name} open onClose={onClose}>
      <View style={{ alignItems: "center", gap: 12, paddingVertical: 12 }}>
        <View style={{ paddingTop: 44 }}>
          <Bubble text={note.text} />
          <Avatar id={note.by} size={88} ring={false} />
        </View>
        <Text style={{ color: t.muted, fontFamily: fonts.body }}>
          Shared {timeAgo(note.at)} ago
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            alignSelf: "stretch",
          }}
        >
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder={`Reply to ${person.username}…`}
            placeholderTextColor={t.muted}
            accessibilityLabel="Reply to note"
            onSubmitEditing={send}
            returnKeyType="send"
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 22,
              paddingHorizontal: 16,
              backgroundColor: t.soft,
              color: t.text,
              fontFamily: fonts.body,
            }}
          />
          <Bounce
            label={fresh?.liked ? "Unlike note" : "Like note"}
            onPress={() => {
              haptic.pop()
              toggleNoteLike(note.by)
            }}
          >
            <LikeHeart liked={!!fresh?.liked} size={26} />
          </Bounce>
        </View>
      </View>
    </Sheet>
  )
}

function NoteComposer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const mine = socialStore.use((s) => s.notes.find((n) => n.by === ME))
  const [text, setText] = useState(mine?.text ?? "")
  const ideas = [
    "leg day 🦵",
    "5K this weekend?",
    "meal prep done ✅",
    "day 30 of no sugar",
    "need a gym buddy",
  ]
  return (
    <Sheet title="New note" open={open} onClose={onClose}>
      <View style={{ alignItems: "center", gap: 14, paddingTop: 12 }}>
        <View style={{ paddingTop: 50 }}>
          <Bubble text={text || undefined} mine />
          <Avatar id={ME} size={88} ring={false} />
        </View>
        <TextInput
          value={text}
          onChangeText={(v) => setText(v.slice(0, 60))}
          placeholder="Share a thought…"
          placeholderTextColor={t.muted}
          accessibilityLabel="Note text"
          autoFocus
          style={{
            alignSelf: "stretch",
            minHeight: 48,
            borderRadius: 14,
            paddingHorizontal: 14,
            backgroundColor: t.soft,
            color: t.text,
            fontFamily: fonts.body,
            fontSize: 16,
            textAlign: "center",
          }}
        />
        <Text style={{ color: t.muted, fontSize: 12 }}>
          {text.length}/60 · Shared with followers you follow back for 24 hours
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {ideas.map((i) => (
            <Pressable
              key={i}
              accessibilityRole="button"
              onPress={() => setText(i)}
              style={{
                paddingHorizontal: 12,
                minHeight: 32,
                justifyContent: "center",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: t.line,
              }}
            >
              <Text
                style={{ color: t.text, fontSize: 13, fontFamily: fonts.body }}
              >
                {i}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={{ flexDirection: "row", gap: 8, alignSelf: "stretch" }}>
          {mine && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                clearNote()
                setText("")
                onClose()
              }}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: t.soft,
              }}
            >
              <Text style={{ color: t.bad, fontFamily: fonts.semibold }}>
                Delete note
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !text.trim() }}
            disabled={!text.trim()}
            onPress={() => {
              setNote(text.trim())
              haptic.done()
              toast.success("Note shared")
              onClose()
            }}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: t.tsk,
              opacity: text.trim() ? 1 : 0.4,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: fonts.semibold }}>
              Share
            </Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  )
}

export function Inbox() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const params = useLocalSearchParams<{ note?: string }>()
  const me = useMe()
  const chats = socialStore.use((s) => s.chats)
  const notes = socialStore.use((s) => s.notes)
  const people = socialStore.use((s) => s.people)
  const [q, setQ] = useState("")
  const [composeNote, setComposeNote] = useState(!!params.note)
  const [viewNote, setViewNote] = useState<Note | null>(null)
  const myNote = notes.find((n) => n.by === ME)
  const sorted = useMemo(() => {
    const last = (c: Chat) => c.messages[c.messages.length - 1]?.at ?? 0
    return [...chats]
      .filter((c) => {
        if (!q) return true
        const title =
          c.name ??
          c.members
            .map((m) => people.find((p) => p.id === m)?.name ?? "")
            .join(" ")
        return title.toLowerCase().includes(q.toLowerCase())
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || last(b) - last(a))
  }, [chats, q, people])
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <TopBar
        title={me.username}
        right={
          <Bounce label="New message" onPress={() => go("/social/new-chat")}>
            <SquarePen size={23} color={t.text} />
          </Bounce>
        }
      />
      <FlatList
        data={sorted}
        keyExtractor={(c) => c.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                margin: 12,
                paddingHorizontal: 12,
                borderRadius: 12,
                backgroundColor: t.soft,
                minHeight: 40,
              }}
            >
              <Search size={16} color={t.muted} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search"
                placeholderTextColor={t.muted}
                accessibilityLabel="Search messages"
                style={{
                  flex: 1,
                  color: t.text,
                  fontFamily: fonts.body,
                  minHeight: 40,
                }}
              />
            </View>
            {!q && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  gap: 14,
                  paddingHorizontal: 12,
                  paddingTop: 40,
                  paddingBottom: 8,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    myNote ? `Your note: ${myNote.text}` : "Leave a note"
                  }
                  onPress={() => setComposeNote(true)}
                  style={{ alignItems: "center", width: 80, gap: 6 }}
                >
                  <View>
                    <Bubble text={myNote?.text} mine />
                    <Avatar id={ME} size={72} ring={false} />
                  </View>
                  <Text
                    numberOfLines={1}
                    style={{
                      color: t.muted,
                      fontSize: 12,
                      fontFamily: fonts.body,
                    }}
                  >
                    {myNote ? "Your note" : "Leave a note"}
                  </Text>
                </Pressable>
                {notes
                  .filter((n) => n.by !== ME)
                  .map((n, i) => (
                    <Animated.View
                      key={n.by}
                      entering={FadeInDown.delay(i * 50)}
                    >
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Note from ${people.find((p) => p.id === n.by)?.username ?? n.by}: ${n.text}`}
                        onPress={() => setViewNote(n)}
                        style={{ alignItems: "center", width: 80, gap: 6 }}
                      >
                        <View>
                          <Bubble text={n.text} />
                          <Avatar id={n.by} size={72} ring={false} />
                        </View>
                        <Text
                          numberOfLines={1}
                          style={{
                            color: t.muted,
                            fontSize: 12,
                            fontFamily: fonts.body,
                          }}
                        >
                          {people.find((p) => p.id === n.by)?.username}
                        </Text>
                      </Pressable>
                    </Animated.View>
                  ))}
              </ScrollView>
            )}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingVertical: 10,
              }}
            >
              <Text
                style={{ color: t.text, fontFamily: fonts.bold, fontSize: 16 }}
              >
                Messages
              </Text>
              <Text
                style={{
                  color: t.muted,
                  fontFamily: fonts.semibold,
                  fontSize: 14,
                }}
                onPress={() => toast("No message requests")}
              >
                Requests
              </Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <Animated.View layout={LinearTransition} entering={FadeIn}>
            <ChatRow chat={item} />
          </Animated.View>
        )}
        ListEmptyComponent={
          <Text
            style={{
              color: t.muted,
              textAlign: "center",
              padding: 32,
              fontFamily: fonts.body,
            }}
          >
            {q
              ? "No chats match your search."
              : "No messages yet. Tap the pencil to start one."}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: safe.bottom + 24 }}
      />
      <NoteComposer open={composeNote} onClose={() => setComposeNote(false)} />
      <NoteViewer note={viewNote} onClose={() => setViewNote(null)} />
    </View>
  )
}

export function NewChat() {
  const t = useTheme()
  const safe = useSafeAreaInsets()
  const people = socialStore.use((s) => s.people)
  const [q, setQ] = useState("")
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState("")
  // Live mode: server search fills the store this list filters.
  useEffect(() => {
    const h = setTimeout(() => void searchLive(q), 300)
    return () => clearTimeout(h)
  }, [q])
  const list = people.filter(
    (p) =>
      p.name.toLowerCase().includes(q.toLowerCase()) ||
      p.username.includes(q.toLowerCase()),
  )
  const group = picked.length > 1
  const start = () => {
    if (!picked.length) return
    haptic.done()
    const id = group
      ? createGroup(
          picked,
          name.trim() ||
            picked
              .map((p) => people.find((x) => x.id === p)?.name.split(" ")[0])
              .join(", "),
        )
      : directChat(picked[0])
    replace(`/social/chat/${id}`)
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: safe.top }}>
      <TopBar
        title="New message"
        right={
          <Pressable
            accessibilityRole="button"
            disabled={!picked.length}
            onPress={start}
            style={{
              paddingHorizontal: 14,
              minHeight: 44,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: picked.length ? t.tsk : t.muted,
                fontFamily: fonts.bold,
                fontSize: 16,
              }}
            >
              {group ? "Create" : "Chat"}
            </Text>
          </Pressable>
        }
      />
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          padding: 12,
          borderBottomWidth: 1,
          borderColor: t.line,
        }}
      >
        <Text style={{ color: t.text, fontFamily: fonts.semibold }}>To:</Text>
        {picked.map((id) => (
          <Animated.View key={id} entering={ZoomIn}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${id}`}
              onPress={() => setPicked((p) => p.filter((x) => x !== id))}
              style={{
                paddingHorizontal: 10,
                minHeight: 28,
                borderRadius: 14,
                justifyContent: "center",
                backgroundColor: `${t.tsk}26`,
              }}
            >
              <Text
                style={{
                  color: t.tsk,
                  fontFamily: fonts.semibold,
                  fontSize: 13,
                }}
              >
                {people.find((p) => p.id === id)?.name}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search people"
          autoFocus
          style={{
            flex: 1,
            minWidth: 100,
            minHeight: 36,
            color: t.text,
            fontFamily: fonts.body,
          }}
        />
      </View>
      {group && (
        <Animated.View
          entering={FadeInDown}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderBottomWidth: 1,
            borderColor: t.line,
          }}
        >
          <Users size={20} color={t.muted} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Group name (optional)"
            placeholderTextColor={t.muted}
            accessibilityLabel="Group name"
            style={{
              flex: 1,
              minHeight: 40,
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 15,
            }}
          />
        </Animated.View>
      )}
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <Text
            style={{
              color: t.text,
              fontFamily: fonts.bold,
              padding: 16,
              paddingBottom: 6,
            }}
          >
            Suggested
          </Text>
        }
        renderItem={({ item }) => {
          const on = picked.includes(item.id)
          return (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={item.name}
              onPress={() => {
                haptic.tap()
                setPicked((p) =>
                  on ? p.filter((x) => x !== item.id) : [...p, item.id],
                )
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 8,
                backgroundColor: pressed ? t.soft : t.bg,
              })}
            >
              <Avatar id={item.id} size={48} ring={false} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontFamily: fonts.semibold }}>
                  {item.name}
                </Text>
                <Text
                  style={{
                    color: t.muted,
                    fontFamily: fonts.body,
                    fontSize: 13,
                  }}
                >
                  {item.username}
                </Text>
              </View>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  borderWidth: on ? 0 : 1.5,
                  borderColor: t.muted,
                  backgroundColor: on ? t.tsk : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {on && <Check size={14} color="#fff" strokeWidth={3} />}
              </View>
            </Pressable>
          )
        }}
        contentContainerStyle={{ paddingBottom: safe.bottom + 24 }}
      />
    </View>
  )
}
