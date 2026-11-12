// Quick-add syntax in a task field: "Reply SOW tomorrow 3pm !high #work".
// The recognised words are coloured in the field as they are typed, and a
// chip under it shows what each one will set; tapping a chip keeps that
// word as plain text in the title instead.
import type { TaskList } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import {
  parseQuickAdd,
  type QuickParse,
  type QuickToken,
} from "@domain/tasks/quick-syntax"
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Repeat,
  X,
} from "lucide-react-native"
import { type ReactNode, useMemo, useState } from "react"
import { Platform, Pressable, Text, View } from "react-native"
import { ListGlyph } from "./screens/task-lists"
import { priorityLook } from "./task-editor"
import { fonts, useTheme } from "./theme"

type Theme = ReturnType<typeof useTheme>

/** The field's text, what it parses to, and the words switched off. */
export function useQuickAdd(
  lists?: readonly TaskList[],
  /** Kinds a field set by hand owns: their words stay text. */
  skip?: ReadonlySet<QuickToken["kind"]>,
) {
  const [text, setRaw] = useState(""),
    [ignore, setIgnore] = useState<ReadonlySet<string>>(new Set()),
    live = useMemo(() => lists?.filter((l) => !l.archivedAt), [lists]),
    parsed = useMemo(
      () => parseQuickAdd(text, { lists: live, ignore, skip }),
      [text, live, ignore, skip],
    )
  return {
    text,
    parsed,
    setText: (s: string) => {
      setRaw(s)
      if (!s.trim()) setIgnore(new Set())
    },
    /** What another line would parse to with the same words switched off
     * (for a submit that carries its own text). */
    parseOf: (line: string) =>
      parseQuickAdd(line, { lists: live, ignore, skip }),
    /** Keep a recognised word as plain text. */
    keep: (key: string) => setIgnore((prev) => new Set(prev).add(key)),
    reset: () => {
      setRaw("")
      setIgnore(new Set())
    },
  }
}

function tokenColor(
  t: Theme,
  token: QuickToken,
  parsed: QuickParse,
  lists?: readonly TaskList[],
) {
  if (token.kind === "priority" && parsed.priority)
    return priorityLook(t, parsed.priority).color
  if (token.kind === "list") {
    const list = lists?.find((l) => l.id === parsed.listId)
    return list ? t[list.color] : t.tsk
  }
  return t.tsk
}

/** Props for the field's TextInput: on a phone the text as styled spans,
 * so recognised words are coloured in place; on the web (where an input
 * cannot hold spans) the plain value. */
export function quickInputProps(
  t: Theme,
  text: string,
  parsed: QuickParse,
  lists?: readonly TaskList[],
): { value?: string; children?: ReactNode } {
  // Spans on a phone whenever there is text, so the input does not switch
  // between a value and children as words come and go (which can jump the
  // cursor); an empty field takes a value so its placeholder shows.
  if (Platform.OS === "web" || !text) return { value: text }
  const parts: ReactNode[] = []
  let at = 0
  for (const tok of parsed.tokens) {
    if (tok.start > at) parts.push(text.slice(at, tok.start))
    const c = tokenColor(t, tok, parsed, lists)
    parts.push(
      <Text
        key={tok.start}
        style={{
          color: c,
          backgroundColor: `${c}26`,
          fontFamily: fonts.medium,
        }}
      >
        {text.slice(tok.start, tok.end)}
      </Text>,
    )
    at = tok.end
  }
  if (at < text.length) parts.push(text.slice(at))
  return { children: <Text>{parts}</Text> }
}

function chipFor(
  t: Theme,
  token: QuickToken,
  parsed: QuickParse,
  lists?: readonly TaskList[],
): { icon: ReactNode; label: string } | null {
  const c = tokenColor(t, token, parsed, lists)
  const day = token.dueDate ? L.fmtDay(token.dueDate) : null,
    time = token.dueTime ? L.fmtTime(token.dueTime) : null
  switch (token.kind) {
    case "date":
      return day
        ? { icon: <CalendarDays size={14} color={c} />, label: day }
        : null
    case "time":
      return time ? { icon: <Clock size={14} color={c} />, label: time } : null
    case "when":
      return day
        ? {
            icon: <CalendarClock size={14} color={c} />,
            // "tonight" next to "7pm": the 7pm is what is saved.
            label:
              time && token.dueTime === parsed.dueTime ? `${day} ${time}` : day,
          }
        : null
    case "repeat": {
      const r = L.fmtRepeat(parsed.recurrence)
      return r ? { icon: <Repeat size={14} color={c} />, label: r } : null
    }
    case "priority": {
      if (!parsed.priority) return null
      const look = priorityLook(t, parsed.priority)
      return {
        icon: <look.icon size={14} color={look.color} />,
        label: L.PRIORITY_LABEL[parsed.priority],
      }
    }
    case "list": {
      const list = lists?.find((l) => l.id === parsed.listId)
      return list
        ? { icon: <ListGlyph list={list} small />, label: list.name }
        : null
    }
  }
}

/** One chip per recognised word, showing what it sets. Tapping one keeps
 * the word as text instead. Nothing renders when nothing was recognised. */
export function QuickChips({
  parsed,
  onKeep,
  lists,
}: {
  parsed: QuickParse
  onKeep: (key: string) => void
  lists?: readonly TaskList[]
}) {
  const t = useTheme()
  const chips = parsed.tokens.flatMap((tok) => {
    const c = chipFor(t, tok, parsed, lists)
    return c ? [{ tok, ...c }] : []
  })
  if (!chips.length) return null
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {chips.map(({ tok, icon, label }) => (
        <Pressable
          key={`${tok.start}-${tok.key}`}
          accessibilityRole="button"
          accessibilityLabel={`${label} from “${tok.text}”. Tap to keep “${tok.text}” as text`}
          hitSlop={6}
          onPress={() => onKeep(tok.key)}
          style={{
            minHeight: 32,
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 8,
            paddingRight: 6,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.card,
          }}
        >
          {icon}
          <Text
            style={{ fontFamily: fonts.medium, fontSize: 13, color: t.text }}
          >
            {label}
          </Text>
          <X size={14} color={t.muted} />
        </Pressable>
      ))}
    </View>
  )
}
