// "Add task": a plain form that creates one task as entered (ADR-0015).
// Free text belongs to Fern; this screen never splits a line into several
// tasks. Quick-add words in the title ("tomorrow 3pm !high #work") fill
// the fields below as they are typed; a field set by hand wins, and the
// word's chip then goes, since it no longer says what will be saved.
import * as A from "@domain/tasks/actions"
import type { TaskPriority } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import {
  Bell,
  CalendarDays,
  Flag,
  FolderOpen,
  Inbox,
  Plus,
} from "lucide-react-native"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { Copy } from "../native-kit"
import { go } from "../navigation"
import { QuickChips, quickInputProps, useQuickAdd } from "../quick-add-field"
import {
  Chip,
  ChipRow,
  DueShortcuts,
  EditorSection,
  PriorityPicker,
  type Remind,
  RemindChoices,
} from "../task-editor"
import { useTheme } from "../theme"
import { Button, DateField, Field, Screen } from "../ui"
import { isDay } from "../validation"
import { LIST_GLYPHS, ListEditor } from "./task-lists"

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function TaskNew({ listId, day }: { listId?: string; day?: string }) {
  const t = useTheme(),
    allLists = tasksStore.use((s) => s.lists),
    lists = useMemo(() => allLists.filter((l) => !l.archivedAt), [allLists]),
    defaultTime = tasksStore.use((s) => s.settings.defaultRemindTime),
    quick = useQuickAdd(allLists),
    [notes, setNotes] = useState(""),
    // null: not set by hand, so the title's words decide.
    [pickedList, setList] = useState<string | null>(listId ?? null),
    [pickedDate, setDate] = useState<string | null>(day ?? null),
    [pickedTime, setTime] = useState<string | null>(null),
    [remind, setRemind] = useState<Remind>("off"),
    [pickedPriority, setPriority] = useState<TaskPriority | null>(null),
    [errors, setErrors] = useState<{ title?: string; when?: string }>({}),
    [making, setMaking] = useState(false)

  const p = quick.parsed,
    date = pickedDate ?? p.dueDate ?? "",
    time = pickedTime ?? p.dueTime ?? "",
    priority = pickedPriority ?? p.priority ?? "none",
    list = pickedList ?? p.listId ?? "",
    overridden = [
      ...(pickedDate !== null ? (["date", "when"] as const) : []),
      ...(pickedTime !== null ? (["time", "when"] as const) : []),
      ...(pickedPriority !== null ? (["priority"] as const) : []),
      ...(pickedList !== null ? (["list"] as const) : []),
    ]

  function save() {
    // A line that is only syntax ("tomorrow !high") keeps its words.
    const name = (p.title || quick.text).replace(/\s+/g, " ").trim()
    const next: typeof errors = {}
    if (!name) next.title = "Give the task a name"
    if ((date && !isDay(date)) || (time && !TIME.test(time)))
      next.when = "Enter a valid date and time"
    else if (remind !== "off" && !date) next.when = "Pick a date to be reminded"
    setErrors(next)
    if (next.title || next.when) return
    const remindAt =
      date && remind !== "off"
        ? new Date(
            new Date(L.isoAt(date, time || defaultTime)).getTime() -
              Number(remind) * 60000,
          ).toISOString()
        : null
    A.createTask({
      title: name,
      notes: notes.trim() || null,
      listId: list || null,
      dueDate: date || null,
      dueTime: time || null,
      remindAt,
      recurrence: date ? p.recurrence : null,
      priority,
      source: "manual",
    })
    go(list ? `/tasks/list/${list}` : "/tasks")
  }

  return (
    <Screen title="New task">
      <View style={{ padding: 16, gap: 8 }}>
        <Field
          label="Task"
          {...quickInputProps(t, quick.text, quick.parsed, lists)}
          onChangeText={quick.setText}
          placeholder="What needs doing? Try “tomorrow 3pm !high”"
          error={errors.title}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
        />
        <QuickChips
          parsed={p}
          onKeep={quick.keep}
          lists={lists}
          hide={overridden}
        />
        <Field
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          multiline
        />
        {/* Grouped by meaning, in the order a task is thought through:
            when it is due, whether to be nudged, how much it matters,
            where it lives. */}
        <EditorSection icon={CalendarDays} title="When">
          <DueShortcuts
            value={date}
            onChange={setDate}
            onClear={() => {
              setDate("")
              setTime("")
            }}
          />
          <DateField
            label="Date"
            value={date}
            onChangeText={setDate}
            clearable
            placeholder="No date"
          />
          <DateField
            label="Time (optional)"
            value={time}
            onChangeText={setTime}
            mode="time"
            defaultValue={defaultTime}
            clearable
            placeholder="Any time"
          />
        </EditorSection>
        <EditorSection icon={Bell} title="Remind me">
          <RemindChoices value={remind} onChange={setRemind} />
        </EditorSection>
        <EditorSection icon={Flag} title="Priority">
          <PriorityPicker value={priority} onChange={setPriority} />
        </EditorSection>
        <EditorSection icon={FolderOpen} title="List">
          <ChipRow
            apart={
              <Chip
                icon={Plus}
                label="New list…"
                color={t.tsk}
                onPress={() => setMaking(true)}
              />
            }
          >
            <Chip
              icon={Inbox}
              label="Inbox"
              color={t.tsk}
              selected={!list}
              onPress={() => setList("")}
            />
            {lists.map((l) => (
              <Chip
                key={l.id}
                icon={LIST_GLYPHS[l.icon]}
                label={l.name}
                color={t[l.color]}
                selected={list === l.id}
                onPress={() => setList(l.id)}
              />
            ))}
          </ChipRow>
        </EditorSection>
        {making && (
          <ListEditor
            onClose={() => setMaking(false)}
            onCreated={(l) => setList(l.id)}
          />
        )}
        {errors.when ? (
          <Copy size={13} style={{ color: t.bad }}>
            {errors.when}
          </Copy>
        ) : null}
        <Button icon={Plus} onPress={save}>
          Add task
        </Button>
      </View>
    </Screen>
  )
}
