// "Add task": a plain form that creates one task as entered (ADR-0015).
// Free text belongs to Fern; this screen never splits or interprets.
import * as A from "@domain/tasks/actions"
import * as L from "@domain/tasks/logic"
import { tasksStore } from "@domain/tasks/store"
import { useMemo, useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { Copy, Line } from "../native-kit"
import { go } from "../navigation"
import { useTheme } from "../theme"
import { Button, Choices, DateField, Field, Screen } from "../ui"
import { isDay } from "../validation"
import { ListEditor } from "./task-lists"

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
type Remind = "off" | "0" | "15" | "60" | "1440"
const NEW_LIST = "__new"

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
      source: "manual",
    })
    toast.success("Task added")
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
        <Choices
          label="List"
          value={list}
          onChange={(v) => (v === NEW_LIST ? setMaking(true) : setList(v))}
          wrap
          options={[
            { value: "", label: "Inbox" },
            ...lists.map((l) => ({ value: l.id, label: l.name })),
            { value: NEW_LIST, label: "New list…" },
          ]}
        />
        {making && (
          <ListEditor
            onClose={() => setMaking(false)}
            onCreated={(l) => setList(l.id)}
          />
        )}
        <Line style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {[
            { label: "Today", day: L.today() },
            { label: "Tomorrow", day: L.addDays(L.today(), 1) },
            { label: "Next week", day: L.addDays(L.today(), 7) },
            { label: "No date", day: "" },
          ].map((p) => (
            <Button
              key={p.label}
              small
              tone={date === p.day ? "primary" : "quiet"}
              onPress={() => setDate(p.day)}
            >
              {p.label}
            </Button>
          ))}
        </Line>
        <DateField label="Date" value={date} onChangeText={setDate} />
        <DateField
          label="Time (optional)"
          value={time}
          onChangeText={setTime}
          mode="time"
        />
        <Choices
          label="Remind me"
          value={remind}
          onChange={setRemind}
          wrap
          options={[
            { value: "off", label: "Off" },
            { value: "0", label: "At time" },
            { value: "15", label: "15 min before" },
            { value: "60", label: "1 hour before" },
            { value: "1440", label: "1 day before" },
          ]}
        />
        {errors.when ? (
          <Copy size={13} style={{ color: t.bad }}>
            {errors.when}
          </Copy>
        ) : null}
        <Button onPress={save}>Add task</Button>
      </View>
    </Screen>
  )
}
