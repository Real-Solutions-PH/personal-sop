import * as A from "@domain/tasks/actions"
import type { TaskSource } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useLocalSearchParams } from "expo-router"
import {
  Camera,
  Check,
  MessageSquareText,
  Mic,
  Undo2,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { liveMode } from "@/live/config"
import { Copy, Frame, IconTap, Line, SectionHeading, Tap } from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Screen } from "../ui"

const examples = [
  "buy eggs and rice, call Mark tomorrow 3pm, finish deck for work by Fri",
  "remind me to pay meralco on the 5th every month",
  "email client after lunch",
  "gym bag, protein, laundry detergent",
]
export function TaskCapture({
  listId,
  day,
}: {
  listId?: string
  day?: string
}) {
  const t = useTheme(),
    p = useLocalSearchParams<{ state?: string }>(),
    [text, setText] = useState(examples[0]),
    [source, setSource] = useState<TaskSource>("capture-text"),
    [results, setResults] = useState<
      { q: string; ids: string[]; followUp?: string; failed?: boolean }[]
    >([])
  function send() {
    if (!text.trim()) return
    const result =
      p.state === "error"
        ? {
            tasks: [A.createTask({ title: text, listId: null, source })],
            followUp: undefined,
          }
        : A.captureTasks(text, source)
    for (const task of result.tasks) {
      if (listId) A.updateTask(task.id, { listId })
      if (day && !task.dueDate) A.setDue(task.id, day)
    }
    setResults((r) => [
      ...r,
      {
        q: text,
        ids: result.tasks.map((t) => t.id),
        followUp: result.followUp,
        failed: p.state === "error",
      },
    ])
    setText("")
  }
  return (
    <Screen title="Capture → tasks" prototypeLayout>
      <View style={{ padding: 16, gap: 16 }}>
        <Copy size={14} muted>
          {liveMode
            ? "Split into tasks and saved to your account. The Capture sheet renders the same result card."
            : "Simulated AI split. The Capture sheet renders the same result card."}
        </Copy>
        {results.map((r, i) => (
          <View key={i} style={{ gap: 8 }}>
            <View
              style={{
                alignSelf: "flex-end",
                maxWidth: "85%",
                borderRadius: 16,
                borderBottomRightRadius: 6,
                backgroundColor: t.primary,
                paddingHorizontal: 12,
                paddingVertical: 8,
              }}
            >
              <Copy size={14} style={{ color: t.onPrimary }}>
                {r.q}
              </Copy>
            </View>
            {r.failed && (
              <Copy size={12} style={{ color: t.warn }}>
                Couldn't split — saved as one task in Inbox. Edit?
              </Copy>
            )}
            <TaskCaptureResult ids={r.ids} followUp={r.followUp} />
          </View>
        ))}
        <SectionHeading>Try a phrase</SectionHeading>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {examples.map((e) => (
            <Tap
              key={e}
              onPress={() => setText(e)}
              style={{
                borderRadius: 20,
                backgroundColor: t.soft,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Copy size={12} lines={2}>
                {e}
              </Copy>
            </Tap>
          ))}
        </View>
        <Line style={{ gap: 8 }}>
          {(
            [
              { v: "capture-text", I: MessageSquareText, l: "Text" },
              { v: "capture-voice", I: Mic, l: "Voice" },
              { v: "capture-photo", I: Camera, l: "Photo" },
            ] as const
          ).map(({ v, I, l }) => (
            <Tap
              key={v}
              onPress={() => setSource(v)}
              style={{
                borderRadius: 20,
                backgroundColor: source === v ? `${t.tsk}26` : t.soft,
                paddingHorizontal: 12,
                paddingVertical: 6,
              }}
            >
              <Line style={{ gap: 6 }}>
                <I size={14} color={source === v ? t.tsk : t.text} />
                <Copy
                  size={14}
                  style={{ color: source === v ? t.tsk : t.text }}
                >
                  {l}
                </Copy>
              </Line>
            </Tap>
          ))}
        </Line>
        <Line style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel="Capture text"
            placeholder="Dump anything…"
            placeholderTextColor={t.muted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            style={{
              height: 48,
              flex: 1,
              minWidth: 0,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.card,
              paddingHorizontal: 12,
              fontFamily: fonts.body,
              fontSize: 16,
              color: t.text,
            }}
          />
          <IconTap
            size={48}
            icon={Check}
            label="Send"
            background={t.tsk}
            color={t.bg}
            onPress={send}
          />
        </Line>
      </View>
    </Screen>
  )
}
export function TaskCaptureResult({
  ids,
  followUp,
}: {
  ids: string[]
  followUp?: string
}) {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    [expanded, setExpanded] = useState(false),
    [undone, setUndone] = useState(false),
    [asked, setAsked] = useState(false),
    rows = s.tasks.filter((t) => ids.includes(t.id)),
    ask = rows.find((t) => t.id === followUp)
  if (undone || !rows.length)
    return (
      <Frame>
        <Copy size={14} muted>
          {undone ? "Undone — nothing was saved." : "All rows removed."}
        </Copy>
      </Frame>
    )
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: t.line,
        borderRadius: 16,
        backgroundColor: t.card,
        overflow: "hidden",
      }}
    >
      <Line
        style={{
          paddingHorizontal: 16,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderColor: t.line,
          gap: 8,
        }}
      >
        <Check color={t.good} size={16} />
        <Copy size={14} weight="medium" style={{ flex: 1 }}>
          Saved {rows.length} task{rows.length === 1 ? "" : "s"}
        </Copy>
        <Tap
          onPress={() => {
            A.removeTasks(ids)
            setUndone(true)
          }}
        >
          <Line style={{ gap: 4 }}>
            <Undo2 size={14} color={t.tsk} />
            <Copy size={14} style={{ color: t.tsk }}>
              Undo all
            </Copy>
          </Line>
        </Tap>
      </Line>
      {(expanded ? rows : rows.slice(0, 5)).map((task) => (
        <Line
          key={task.id}
          style={{
            paddingHorizontal: 16,
            gap: 8,
            borderBottomWidth: 1,
            borderColor: t.line,
          }}
        >
          <Tap
            onPress={() => go(`/tasks/task/${task.id}`)}
            style={{ flex: 1, paddingVertical: 10 }}
          >
            <Copy size={14} weight="medium" lines={1}>
              {task.title}
            </Copy>
            <Copy size={12} muted>
              {s.lists.find((l) => l.id === task.listId)?.name ?? "Inbox"}
              {task.dueDate
                ? ` · ${L.fmtDay(task.dueDate)}${task.dueTime ? ` ${L.fmtTime(task.dueTime)}` : ""}`
                : ""}
            </Copy>
          </Tap>
          <IconTap
            size={32}
            icon={X}
            label={`Remove ${task.title}`}
            onPress={() => A.removeTasks([task.id])}
          />
        </Line>
      ))}
      {rows.length > 5 && !expanded && (
        <Tap onPress={() => setExpanded(true)} style={{ padding: 16 }}>
          <Copy size={14} muted>
            +{rows.length - 5} more
          </Copy>
        </Tap>
      )}
      {ask && !asked && (
        <View style={{ padding: 16, gap: 8 }}>
          <Copy size={14}>Remind you about “{ask.title}” at 1pm?</Copy>
          <Line>
            {["13:00", "14:00", "none"].map((tm) => (
              <Tap
                key={tm}
                onPress={() => {
                  if (tm !== "none" && ask.dueDate) {
                    A.setDue(ask.id, ask.dueDate, tm)
                    A.updateTask(ask.id, { remindAt: L.isoAt(ask.dueDate, tm) })
                  }
                  setAsked(true)
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 20,
                  backgroundColor: t.soft,
                }}
              >
                <Copy size={14}>
                  {tm === "none" ? "No reminder" : L.fmtTime(tm)}
                </Copy>
              </Tap>
            ))}
          </Line>
        </View>
      )}
    </View>
  )
}
