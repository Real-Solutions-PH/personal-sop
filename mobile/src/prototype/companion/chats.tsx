// The person's chats with the companion: start a new one, open an older
// one, rename or delete it. A new chat starts with a clean context; what
// the companion remembers about them still applies in every chat.
import { Check, Pencil, Plus, Trash2 } from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import { Copy, IconTap, Line, Tap } from "../native-kit"
import { fonts, useTheme } from "../theme"
import { Button, confirm, Sheet } from "../ui"
import {
  chatList,
  companionStore,
  currentThread,
  deleteChat,
  newChat,
  openChat,
  renameChat,
} from "./store"

const when = (at: number) => {
  const d = new Date(at)
  const today = new Date()
  const days = Math.round(
    (new Date(today.toDateString()).getTime() -
      new Date(d.toDateString()).getTime()) /
      86_400_000,
  )
  if (days === 0)
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (days === 1) return "Yesterday"
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" })
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function ChatsSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const t = useTheme()
  const s = companionStore.use((x) => x)
  const chats = chatList(s)
  const active = currentThread(s)
  const [editing, setEditing] = useState<string | null>(null),
    [draft, setDraft] = useState("")
  const save = () => {
    if (editing) renameChat(editing, draft)
    setEditing(null)
  }
  return (
    <Sheet title="Chats" open={open} onClose={onClose}>
      <Button
        icon={Plus}
        onPress={() => {
          newChat()
          onClose()
        }}
      >
        New chat
      </Button>
      <View style={{ gap: 2 }}>
        {chats.map((c) => {
          const count = s.messages.filter((m) => m.threadId === c.id).length
          const title = c.title ?? (count ? "Chat" : "New chat")
          const on = c.id === active
          return (
            <Line
              key={c.id}
              style={{
                gap: 4,
                borderRadius: 14,
                paddingLeft: 12,
                backgroundColor: on ? t.soft : "transparent",
              }}
            >
              {editing === c.id ? (
                <TextInput
                  accessibilityLabel="Chat name"
                  autoFocus
                  value={draft}
                  onChangeText={setDraft}
                  onSubmitEditing={save}
                  onBlur={save}
                  returnKeyType="done"
                  maxLength={80}
                  style={{
                    flex: 1,
                    minHeight: 52,
                    fontFamily: fonts.medium,
                    fontSize: 15,
                    color: t.text,
                  }}
                />
              ) : (
                <Tap
                  label={`Open ${title}`}
                  onPress={() => {
                    openChat(c.id)
                    onClose()
                  }}
                  style={{ flex: 1, minHeight: 52, justifyContent: "center" }}
                >
                  <Copy size={15} weight={on ? "semibold" : "medium"} lines={1}>
                    {title}
                  </Copy>
                  <Copy size={12} muted>
                    {c.lastAt ? when(c.lastAt) : "Nothing yet"}
                  </Copy>
                </Tap>
              )}
              {editing === c.id ? (
                <IconTap icon={Check} label="Save name" onPress={save} />
              ) : (
                <>
                  <IconTap
                    icon={Pencil}
                    label={`Rename ${title}`}
                    color={t.muted}
                    onPress={() => {
                      setDraft(c.title ?? "")
                      setEditing(c.id)
                    }}
                  />
                  <IconTap
                    icon={Trash2}
                    label={`Delete ${title}`}
                    color={t.muted}
                    onPress={() =>
                      confirm(
                        "Delete this chat?",
                        "Its messages go too. What Fern remembers about you stays.",
                        () => {
                          deleteChat(c.id)
                          toast("Chat deleted")
                        },
                        "Delete",
                      )
                    }
                  />
                </>
              )}
            </Line>
          )
        })}
        {!chats.length && (
          <Copy size={14} muted style={{ paddingVertical: 12 }}>
            Your chats show here. Each one keeps its own conversation.
          </Copy>
        )}
      </View>
    </Sheet>
  )
}
