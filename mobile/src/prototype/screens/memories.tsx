// What the companion remembers about the person, grouped by kind: each
// memory's tags and where it came from, a switch that keeps it in every
// conversation, and an editor to change, forget or add one by hand.
import { Brain, Pin, Plus } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import {
  ALWAYS_ON_KINDS,
  isKind,
  KIND_LABEL,
  MEMORY_KINDS,
  type MemoryKind,
  parseTags,
  sourceLabel,
} from "../companion/memory-labels"
import {
  companionStore,
  editMemory,
  forget,
  type Memory,
  remember,
  restoreMemory,
} from "../companion/store"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, Choices, confirm, Field, Screen, Sheet, undo } from "../ui"
import { LockedPreview } from "./locked-preview"

const MAX_TEXT = 500

/** Shown dimmed under the empty state: what the page holds once the
 * companion has learned a few things. */
const SAMPLE: Memory[] = [
  {
    id: "sample-style",
    text: "Prefers short answers in bullet points",
    at: 0,
    kind: "response_style",
    tags: ["answers"],
    source: "said",
  },
  {
    id: "sample-goal",
    text: "Training for a 10K before December",
    at: 0,
    kind: "goal",
    tags: ["running", "fitness"],
    source: "said",
    alwaysOn: true,
  },
  {
    id: "sample-routine",
    text: "Walks the dog every morning at 7",
    at: 0,
    kind: "routine",
    tags: ["dog", "morning"],
    source: "inferred",
  },
]

/** Group by kind in MEMORY_KINDS order; kinds the app does not know yet
 * follow, under their own name. */
function groups(memories: Memory[]) {
  const by = new Map<string, Memory[]>()
  for (const m of memories) {
    const k = m.kind ?? "fact"
    by.set(k, [...(by.get(k) ?? []), m])
  }
  const known = MEMORY_KINDS.filter((k) => by.has(k))
  const other = [...by.keys()].filter((k) => !isKind(k)).sort()
  return [...known, ...other].map((k) => ({
    kind: k,
    label: isKind(k) ? KIND_LABEL[k] : k,
    items: by.get(k) ?? [],
  }))
}

type Editing = { memory?: Memory } | null

export function Memories() {
  const t = useTheme()
  const name = companionStore.use((s) => s.name)
  const memories = companionStore.use((s) => s.memories)
  const [editing, setEditing] = useState<Editing>(null)
  const empty = memories.length === 0
  const list = groups(empty ? SAMPLE : memories)
  const pinned = memories.filter(
    (m) => m.alwaysOn || ALWAYS_ON_KINDS.has(m.kind ?? ""),
  ).length
  const toggle = (m: Memory, alwaysOn: boolean) => {
    editMemory(m.id, { alwaysOn })
  }
  return (
    <Screen
      title="Memories"
      eyebrow={name}
      actions={
        <IconTap
          size={44}
          icon={Plus}
          label="Add a memory"
          color={t.text}
          onPress={() => setEditing({})}
        />
      }
    >
      <View style={{ gap: 4 }}>
        <Copy size={14} muted>
          What {name} knows about you. Always-on memories are part of every
          conversation; the rest come up when a question needs them.
        </Copy>
        {!empty && (
          <Copy size={12} muted>
            {memories.length.toLocaleString()}{" "}
            {memories.length === 1 ? "memory" : "memories"} ·{" "}
            {pinned.toLocaleString()} always on
          </Copy>
        )}
      </View>
      <LockedPreview
        locked={empty}
        icon={Brain}
        color={t.hab}
        title={`${name} hasn't learned anything yet`}
        detail={`Tell ${name} “remember that …” in a conversation, or add a memory here.`}
        action={{ label: "Add a memory", onPress: () => setEditing({}) }}
      >
        {list.map((g) => (
          <View key={g.kind}>
            <SectionHeading
              action={
                ALWAYS_ON_KINDS.has(g.kind) ? (
                  <Copy size={12} muted>
                    Always on
                  </Copy>
                ) : undefined
              }
            >
              {g.label}
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 12 }}>
              {g.items.map((m, i) => (
                <MemoryRow
                  key={m.id}
                  memory={m}
                  name={name}
                  first={i === 0}
                  onOpen={() => setEditing({ memory: m })}
                  onToggle={(v) => toggle(m, v)}
                />
              ))}
            </Frame>
          </View>
        ))}
      </LockedPreview>
      {editing && (
        <MemoryEditor
          memory={editing.memory}
          name={name}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  )
}

function MemoryRow({
  memory: m,
  name,
  first,
  onOpen,
  onToggle,
}: {
  memory: Memory
  name: string
  first: boolean
  onOpen: () => void
  onToggle: (v: boolean) => void
}) {
  const t = useTheme()
  const fixed = ALWAYS_ON_KINDS.has(m.kind ?? "")
  const tags = m.tags ?? []
  return (
    <Line
      style={{
        gap: 12,
        paddingVertical: 12,
        alignItems: "flex-start",
        borderTopWidth: first ? 0 : 1,
        borderTopColor: border(t.line, 0.5),
      }}
    >
      <Tap
        onPress={onOpen}
        label={`Edit: ${m.text}`}
        style={{ flex: 1, gap: 6 }}
      >
        <Copy size={15}>{m.text}</Copy>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Copy size={12} muted>
            {sourceLabel(m.source, name)}
          </Copy>
          {tags.map((tag) => (
            <View
              key={tag}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: t.soft,
              }}
            >
              <Copy size={12}>#{tag}</Copy>
            </View>
          ))}
        </View>
      </Tap>
      {fixed ? (
        <View style={{ paddingTop: 2 }}>
          <Pin size={16} color={t.hab} accessibilityLabel="Always on" />
        </View>
      ) : (
        <Switch
          compact
          accent="hab"
          label={`Always on: ${m.text}`}
          value={m.alwaysOn ?? false}
          onChange={onToggle}
        />
      )}
    </Line>
  )
}

function MemoryEditor({
  memory,
  name,
  onClose,
}: {
  memory?: Memory
  name: string
  onClose: () => void
}) {
  const t = useTheme()
  const [text, setText] = useState(memory?.text ?? "")
  const [kind, setKind] = useState<string>(memory?.kind ?? "fact")
  const [tags, setTags] = useState((memory?.tags ?? []).join(", "))
  const [alwaysOn, setAlwaysOn] = useState(memory?.alwaysOn ?? false)
  const [error, setError] = useState<string>()
  const fixed = ALWAYS_ON_KINDS.has(kind)
  const kinds: { value: string; label: string }[] = MEMORY_KINDS.map(
    (k: MemoryKind) => ({ value: k, label: KIND_LABEL[k] }),
  )
  if (!isKind(kind)) kinds.push({ value: kind, label: kind })
  const save = () => {
    const body = text.trim().replace(/\s+/g, " ")
    if (!body) {
      setError("Write what to remember")
      return
    }
    const fields = { text: body, kind, tags: parseTags(tags), alwaysOn }
    if (memory) editMemory(memory.id, fields)
    else remember(body, { ...fields, source: "app" })
    onClose()
  }
  const remove = () => {
    if (!memory) return
    confirm("Forget this?", `${name} stops using “${memory.text}”.`, () => {
      const index = companionStore
        .get()
        .memories.findIndex((m) => m.id === memory.id)
      forget(memory.id)
      onClose()
      undo("Memory forgotten", () => restoreMemory(memory, index))
    })
  }
  return (
    <Sheet
      open
      title={memory ? "Edit memory" : "Add a memory"}
      onClose={onClose}
    >
      <View style={{ gap: 12 }}>
        <Field
          label="What to remember"
          value={text}
          onChangeText={(v) => {
            setText(v)
            setError(undefined)
          }}
          placeholder="e.g. I'm vegetarian on Fridays"
          multiline
          maxLength={MAX_TEXT}
          error={error}
        />
        <Choices
          label="Kind"
          wrap
          value={kind}
          options={kinds}
          onChange={setKind}
        />
        <Field
          label="Tags"
          value={tags}
          onChangeText={setTags}
          placeholder="running, mornings"
          autoCapitalize="none"
        />
        <Line style={{ gap: 12, minHeight: 56 }}>
          <View style={{ flex: 1 }}>
            <Copy size={15} weight="medium">
              Always on
            </Copy>
            <Copy size={12} muted>
              {fixed
                ? `${KIND_LABEL[kind as MemoryKind]} is always part of every conversation`
                : `In every conversation, not only when ${name} looks it up`}
            </Copy>
          </View>
          {fixed ? (
            <Pin size={16} color={t.hab} accessibilityLabel="Always on" />
          ) : (
            <Switch
              compact
              accent="hab"
              label="Always on"
              value={alwaysOn}
              onChange={setAlwaysOn}
            />
          )}
        </Line>
        <Button onPress={save}>{memory ? "Save changes" : "Add memory"}</Button>
        {memory && (
          <Button tone="danger" onPress={remove}>
            Forget this memory
          </Button>
        )}
      </View>
    </Sheet>
  )
}
