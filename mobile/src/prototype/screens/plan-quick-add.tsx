// Quick add on the Plan day view: a "+ Add" row at the end of each block
// (Anytime, Early morning, Morning, Afternoon, Night) opens a field that
// adds a task or a habit to the selected day, at that block's time. Tasks
// use the task quick-add words ("3pm !high #work"); a habit takes its name
// and any time word, and starts daily as a check habit. The full task or
// habit screen, prefilled, is one tap away for everything else.
import { createHabit } from "@domain/habits/actions"
import * as A from "@domain/tasks/actions"
import type { QuickToken } from "@domain/tasks/quick-syntax"
import { tasksStore } from "@domain/tasks/store"
import { Maximize2, Plus } from "lucide-react-native"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { Text, TextInput, View } from "react-native"
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"
import { feel, MOTION } from "../motion"
import { border, Copy, IconTap, Line, Segmented, Tap } from "../native-kit"
import { go } from "../navigation"
import { QuickChips, quickInputProps, useQuickAdd } from "../quick-add-field"
import { fonts, useTheme } from "../theme"

export type QuickKind = "task" | "habit"
/** Where a quick add was opened: its block's name and default time. */
export interface QuickBlock {
  key: string
  label: string
  /** "HH:MM", or null for Anytime. */
  time: string | null
}
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
// A habit has no priority, list or repeat: those words stay in its name.
const HABIT_SKIP: ReadonlySet<QuickToken["kind"]> = new Set([
  "priority",
  "list",
  "repeat",
])

/** What a quick-add line makes on `day` from `block`. Typed date words
 * move the day; a typed time beats the block's. */
export function quickAdd(
  kind: QuickKind,
  line: string,
  parsed: ReturnType<ReturnType<typeof useQuickAdd>["parseOf"]>,
  day: string,
  block: QuickBlock,
  today: string,
): { id: string } | { error: string } {
  // A time or repeat word alone implies today in the parser; only a date
  // word may move the day the field was opened on.
  const dateWord = parsed.tokens.some(
      (k) => k.kind === "date" || k.kind === "when",
    ),
    on = (dateWord ? parsed.dueDate : null) ?? day,
    time = parsed.dueTime ?? block.time,
    // A line that is only syntax ("tomorrow !high") keeps its words.
    title = (parsed.title || line).replace(/\s+/g, " ").trim()
  if (!title)
    return { error: `Give the ${kind === "task" ? "task" : "habit"} a name` }
  try {
    if (kind === "task")
      return {
        id: A.createTask({
          title,
          listId: parsed.listId ?? null,
          dueDate: on,
          dueTime: time,
          recurrence: parsed.recurrence,
          remind: !!time,
          priority: parsed.priority ?? undefined,
          source: "manual",
        }).id,
      }
    return {
      id: createHabit(
        {
          name: title,
          type: "check",
          schedule: [{ days: EVERY_DAY, ...(time ? { time } : {}) }],
        },
        // Added on a past day: it starts there, so it shows on that day.
        { startsOn: on < today ? on : undefined },
      ).id,
    }
  } catch {
    return { error: "Couldn't add that. Try again." }
  }
}

/** The "+ Add" row of one block, and its field while open. Only one block's
 * field is open at a time (the parent owns which). */
export function PlanQuickAdd({
  day,
  today,
  block,
  open,
  onOpen,
  onClose,
  onAdded,
}: {
  day: string
  today: string
  block: QuickBlock
  open: boolean
  onOpen: () => void
  onClose: () => void
  onAdded: (id: string) => void
}) {
  const t = useTheme(),
    [kind, setKind] = useState<QuickKind>("task"),
    lists = tasksStore.use((s) => s.lists),
    quick = useQuickAdd(lists, kind === "habit" ? HABIT_SKIP : undefined),
    [error, setError] = useState<string | null>(null),
    input = useRef<TextInputInstance>(null),
    blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    text = quick.text
  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )
  const close = () => {
    quick.reset()
    setError(null)
    onClose()
  }
  const add = (line = text) => {
    if (!line.trim()) return
    const made = quickAdd(kind, line, quick.parseOf(line), day, block, today)
    if ("error" in made) {
      setError(made.error)
      feel.error()
      return
    }
    setError(null)
    feel.select()
    onAdded(made.id)
    quick.reset()
    // Stays open and focused for the next one.
    input.current?.focus()
  }
  const more = () => {
    const p = quick.parsed,
      typedTime = p.tokens.some((k) => k.kind === "time" || k.kind === "when"),
      // A task takes the line as typed (its screen reads the words again);
      // a habit takes its name and the time.
      title = (kind === "task" ? text : p.title || text).trim(),
      time =
        kind === "task"
          ? typedTime
            ? null
            : block.time
          : (p.dueTime ?? block.time),
      q = [
        title &&
          `${kind === "task" ? "title" : "name"}=${encodeURIComponent(title)}`,
        kind === "task" && `day=${day}`,
        time && `time=${time}`,
      ]
        .filter(Boolean)
        .join("&")
    close()
    go(`${kind === "task" ? "/tasks/new" : "/habits/new"}?${q}`)
  }
  if (!open)
    return (
      <Tap
        label={`Add to ${block.label}`}
        onPress={onOpen}
        style={{ minHeight: 44, justifyContent: "center", paddingVertical: 4 }}
      >
        <Line style={{ gap: 6 }}>
          <Plus size={16} color={t.muted} />
          <Copy size={14} muted>
            Add
          </Copy>
        </Line>
      </Tap>
    )
  const noun = kind === "task" ? "task" : "habit"
  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      <Segmented
        value={kind}
        onChange={(k) => {
          setKind(k)
          setError(null)
          input.current?.focus()
        }}
        options={[
          { value: "task", label: "Task" },
          { value: "habit", label: "Habit" },
        ]}
      />
      <Line
        style={{
          paddingLeft: 12,
          gap: 4,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: error ? t.bad : border(t.line, 0.6),
          backgroundColor: t.card,
        }}
      >
        <TextInput
          ref={input}
          accessibilityLabel={`Quick add ${noun}`}
          {...quickInputProps(t, text, quick.parsed, lists)}
          // Return adds rather than breaking the line (the web ignores
          // submitBehavior and types a newline).
          onChangeText={(next) => {
            if (error) setError(null)
            if (/\n/.test(next)) add(next.replace(/\s*\n+\s*/g, " ").trim())
            else quick.setText(next)
          }}
          onSubmitEditing={() => add()}
          onKeyPress={(e) => {
            if (e.nativeEvent.key === "Escape") close()
          }}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
          }}
          // Leaving an empty field folds it away; a tap on the toggle or
          // Add refocuses it before this fires.
          onBlur={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
            blurTimer.current = setTimeout(() => {
              if (!input.current?.isFocused() && !quick.text.trim()) close()
            }, 200)
          }}
          autoFocus
          returnKeyType="done"
          multiline
          submitBehavior="submit"
          placeholder={
            kind === "task"
              ? `Add a task${block.time ? "" : " · try “3pm !high”"}`
              : "Add a daily habit, e.g. Stretch"
          }
          placeholderTextColor={t.muted}
          style={{
            minHeight: 48,
            paddingVertical: 12,
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 16,
            color: t.text,
          }}
        />
        {!!text.trim() && (
          <Tap
            label={`Add ${noun}`}
            onPress={() => add()}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Copy size={14} weight="semibold" style={{ color: t.primary }}>
              Add
            </Copy>
          </Tap>
        )}
        <IconTap
          size={44}
          icon={Maximize2}
          label={`More ${noun} options`}
          onPress={more}
        />
      </Line>
      {error && (
        <Text accessibilityRole="alert" style={{ color: t.bad }}>
          {error}
        </Text>
      )}
      <QuickChips parsed={quick.parsed} onKeep={quick.keep} lists={lists} />
    </View>
  )
}

/** A row that just landed fades and rises into place. Shared values, not
 * an `entering` layout animation, which floats the row on the web. */
export function FreshIn({ children }: { children: ReactNode }) {
  const p = useSharedValue(0)
  useEffect(() => {
    p.value = withTiming(1, {
      duration: MOTION.base,
      reduceMotion: ReduceMotion.Never,
    })
  }, [p])
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * 8 }],
  }))
  return <Animated.View style={style}>{children}</Animated.View>
}
