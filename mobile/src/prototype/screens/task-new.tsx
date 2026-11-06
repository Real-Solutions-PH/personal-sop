// "Add task": a plain form that creates one task as entered (ADR-0015).
// Free text belongs to Fern; this screen never splits or interprets.
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
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState(""),
    [list, setList] = useState(listId ?? ""),
    [date, setDate] = useState(day ?? ""),
    [time, setTime] = useState(""),
    [remind, setRemind] = useState<Remind>("off"),
    [priority, setPriority] = useState<TaskPriority>("none"),
    [errors, setErrors] = useState<{ title?: string; when?: string }>({}),
    [making, setMaking] = useState(false)

  function save() {
    const name = title.replace(/\s+/g, " ").trim()
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
          value={title}
          onChangeText={setTitle}
          placeholder="What needs doing?"
          error={errors.title}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={save}
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
