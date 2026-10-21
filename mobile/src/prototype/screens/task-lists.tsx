import * as A from "@domain/tasks/actions"
import type { ListColor, ListIcon, TaskList } from "@domain/tasks/data"
import * as L from "@domain/tasks/logic"
import { parseTask } from "@domain/tasks/parse"
import { tasksStore } from "@domain/tasks/store"
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Briefcase,
  ChevronRight,
  Gift,
  Heart,
  House,
  Inbox,
  Laptop,
  List,
  Pencil,
  Plane,
  Plus,
  Search,
  ShoppingCart,
  Star,
} from "lucide-react-native"
import { useRef, useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  IconTap,
  Line,
  SectionHeading,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen, Sheet, Toggle, undo } from "../ui"
import { TaskRow } from "./tasks"

const icons = {
  briefcase: Briefcase,
  laptop: Laptop,
  home: House,
  cart: ShoppingCart,
  heart: Heart,
  book: BookOpen,
  plane: Plane,
  gift: Gift,
  list: List,
}
export function ListGlyph({
  list,
  small = false,
}: {
  list: TaskList | "inbox" | "starred" | null
  small?: boolean
}) {
  const t = useTheme(),
    color =
      typeof list === "object" && list
        ? t[list.color]
        : list === "starred"
          ? t.warn
          : t.tsk,
    Icon =
      typeof list === "object" && list
        ? icons[list.icon]
        : list === "starred"
          ? Star
          : Inbox
  return (
    <View
      style={{
        width: small ? 28 : 40,
        height: small ? 28 : 40,
        borderRadius: small ? 8 : 12,
        backgroundColor: `${color}26`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={small ? 16 : 20} color={color} />
    </View>
  )
}
export function ListEditor({
  list,
  onClose,
}: {
  list?: TaskList
  onClose: () => void
}) {
  const t = useTheme(),
    s = tasksStore.use((s) => s),
    [name, setName] = useState(list?.name ?? ""),
    [color, setColor] = useState<ListColor>(list?.color ?? "tsk"),
    [icon, setIcon] = useState<ListIcon>(list?.icon ?? "list"),
    [shopping, setShopping] = useState(list?.kind === "shopping"),
    [confirm, setConfirm] = useState(false),
    count = s.tasks.filter(
      (t) => t.listId === list?.id && t.status === "open",
    ).length
  return (
    <Sheet title={list ? "Edit list" : "New list"} open onClose={onClose}>
      <TextInput
        accessibilityLabel="List name"
        value={name}
        onChangeText={setName}
        placeholder="List name — e.g. Side hustle"
        placeholderTextColor={t.muted}
        style={{
          height: 48,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 12,
          paddingHorizontal: 12,
          fontFamily: fonts.body,
          fontSize: 16,
          color: t.text,
        }}
      />
      <Line style={{ gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        {(["tsk", "fin", "hab", "fit", "life", "warn"] as const).map((c) => (
          <Tap
            key={c}
            label={`Colour ${c}`}
            onPress={() => setColor(c)}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: t[c],
              borderWidth: color === c ? 2 : 0,
              borderColor: t.text,
            }}
          >
            {null}
          </Tap>
        ))}
      </Line>
      <Line style={{ gap: 6, marginTop: 4 }}>
        {(Object.keys(icons) as ListIcon[]).map((i) => {
          const Icon = icons[i]
          return (
            <Tap
              key={i}
              label={`Icon ${i}`}
              onPress={() => setIcon(i)}
              style={{
                flex: 1,
                aspectRatio: 1,
                borderRadius: 8,
                backgroundColor: icon === i ? t.text : t.soft,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={16} color={icon === i ? t.bg : t.muted} />
            </Tap>
          )
        })}
      </Line>
      <View
        style={{
          marginTop: 4,
          padding: 12,
          borderRadius: 12,
          backgroundColor: border(t.soft, 0.5),
        }}
      >
        <Toggle label="Shopping mode" value={shopping} onChange={setShopping} />
        <Copy size={12} muted>
          Checkboxes, no dates, “In cart” + Clear checked.
        </Copy>
      </View>
      {confirm && list ? (
        <View
          style={{
            padding: 12,
            gap: 8,
            borderRadius: 16,
            backgroundColor: `${t.bad}1a`,
          }}
        >
          <Copy size={14} weight="medium">
            Delete “{list.name}”? It has {count} open task
            {count === 1 ? "" : "s"}.
          </Copy>
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                onPress={() => {
                  A.deleteList(list.id, "inbox")
                  toast.success("Open tasks moved to Inbox")
                  onClose()
                }}
              >
                Move to Inbox
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="danger"
                onPress={() => {
                  A.deleteList(list.id, "delete")
                  toast.success(`Deleted ${list.name} and its tasks`)
                  onClose()
                }}
              >
                Delete tasks
              </Button>
            </View>
          </Line>
        </View>
      ) : (
        <Line style={{ marginTop: 8, marginBottom: 12, gap: 8 }}>
          {list && (
            <>
              <Button
                tone="quiet"
                onPress={() => {
                  A.setListArchived(list.id, !list.archivedAt)
                  toast.success(
                    list.archivedAt ? "Unarchived" : `Archived ${list.name}`,
                  )
                  onClose()
                }}
              >
                {list.archivedAt ? "Unarchive" : "Archive"}
              </Button>
              <Button
                tone="danger"
                onPress={() => {
                  if (count) setConfirm(true)
                  else {
                    A.deleteList(list.id, "inbox")
                    onClose()
                  }
                }}
              >
                Delete
              </Button>
            </>
          )}
          <View style={{ flex: 1 }}>
            <Button
              disabled={!name.trim()}
              onPress={() => {
                const input = {
                  name: name.trim(),
                  kind: shopping
                    ? ("shopping" as const)
                    : ("standard" as const),
                  color,
                  icon,
                }
                if (list) A.updateList(list.id, input)
                else A.createList(input)
                toast.success(list ? "List saved" : `Created ${name.trim()}`)
                onClose()
              }}
            >
              {list ? "Save" : "Create list"}
            </Button>
          </View>
        </Line>
      )}
    </Sheet>
  )
}
export function TaskLists() {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    [editing, setEditing] = useState<TaskList | "new" | null>(null),
    all = [...s.lists].sort((a, b) => a.sortOrder - b.sortOrder),
    active = all.filter((l) => !l.archivedAt),
    archived = all.filter((l) => l.archivedAt),
    count = (id: string) =>
      s.tasks.filter((t) => t.listId === id && t.status === "open").length
  return (
    <Screen
      title="Lists"
      actions={
        <IconTap
          size={40}
          icon={Plus}
          label="New list"
          onPress={() => setEditing("new")}
        />
      }
    >
      {!active.length ? (
        <Empty
          title="No lists yet"
          detail="Everything goes to Inbox until you make one. Buckets like Work, Life, Groceries help."
          action={<Button onPress={() => setEditing("new")}>New list</Button>}
        />
      ) : (
        <>
          <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
            Order here is the order everywhere.
          </Copy>
          <View style={{ marginTop: -4 }}>
            {active.map((l, i) => (
              <Line key={l.id} style={{ gap: 4 }}>
                <Tap
                  onPress={() => setEditing(l)}
                  style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 12 }}
                >
                  <Line>
                    <ListGlyph list={l} />
                    <View style={{ flex: 1 }}>
                      <Copy weight="medium">{l.name}</Copy>
                      <Copy size={14} muted>
                        {count(l.id)} open
                        {l.kind === "shopping" ? " · shopping" : ""}
                      </Copy>
                    </View>
                  </Line>
                </Tap>
                <IconTap
                  icon={ArrowUp}
                  label={`Move ${l.name} up`}
                  size={36}
                  color={i ? t.muted : border(t.muted, 0.3)}
                  onPress={() => {
                    if (i) A.moveList(l.id, -1)
                  }}
                />
                <IconTap
                  icon={ArrowDown}
                  label={`Move ${l.name} down`}
                  size={36}
                  color={
                    i === active.length - 1 ? border(t.muted, 0.3) : t.muted
                  }
                  onPress={() => {
                    if (i < active.length - 1) A.moveList(l.id, 1)
                  }}
                />
                <IconTap
                  icon={Pencil}
                  label={`Edit ${l.name}`}
                  size={36}
                  onPress={() => setEditing(l)}
                />
              </Line>
            ))}
          </View>
          <Button tone="quiet" icon={Plus} onPress={() => setEditing("new")}>
            New list
          </Button>
        </>
      )}
      {!!archived.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading>Archived</SectionHeading>
          {archived.map((l) => (
            <Line
              key={l.id}
              style={{ paddingHorizontal: 4, paddingVertical: 12 }}
            >
              <ListGlyph list={l} />
              <View style={{ flex: 1 }}>
                <Copy weight="medium" muted>
                  {l.name}
                </Copy>
                <Copy size={14} muted>
                  {count(l.id)} open — hidden from Tasks
                </Copy>
              </View>
              <Button
                small
                tone="quiet"
                onPress={() => A.setListArchived(l.id, false)}
              >
                Unarchive
              </Button>
            </Line>
          ))}
        </View>
      )}
      {editing && (
        <ListEditor
          key={editing === "new" ? "new" : editing.id}
          list={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Screen>
  )
}
export function TaskListPage({ id }: { id: string }) {
  const s = tasksStore.use((s) => s),
    t = useTheme(),
    list = s.lists.find((l) => l.id === id),
    smart = id === "inbox" || id === "starred",
    shopping = list?.kind === "shopping",
    [sort, setSort] = useState("due"),
    [showDone, setShowDone] = useState(false),
    [edit, setEdit] = useState(false),
    [text, setText] = useState(""),
    input = useRef<TextInput>(null),
    mine = s.tasks.filter((task) =>
      id === "inbox"
        ? task.listId === null
        : id === "starred"
          ? task.starred
          : task.listId === id,
    ),
    open = mine
      .filter((t) => t.status === "open")
      .sort(
        shopping || sort === "manual"
          ? (a, b) => a.order - b.order
          : sort === "created"
            ? (a, b) => b.createdAt.localeCompare(a.createdAt)
            : L.byDue,
      ),
    allDone = mine
      .filter((t) => t.status === "done")
      .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    done = allDone.filter((t) => !shopping || t.clearedAt),
    cart = shopping ? allDone.filter((t) => !t.clearedAt) : [],
    title =
      id === "inbox"
        ? "Inbox"
        : id === "starred"
          ? "Starred"
          : (list?.name ?? "List")
  const add = () => {
    if (!text.trim()) return
    const p = parseTask(text)
    A.createTask(
      shopping
        ? { title: text.trim(), listId: id }
        : {
            title: p.title,
            listId: smart ? null : id,
            dueDate: p.dueDate,
            dueTime: p.dueTime,
            recurrence: p.recurrence,
            remind: !!p.dueTime,
            starred: id === "starred",
          },
    )
    setText("")
    input.current?.focus()
  }
  if (!smart && !list)
    return (
      <Screen title="List">
        <Empty title="List not found" detail="It may have been deleted." />
      </Screen>
    )
  return (
    <Screen
      title={title}
      titleContent={
        <Line style={{ gap: 8 }}>
          <ListGlyph
            list={list ?? (id === "starred" ? "starred" : "inbox")}
            small
          />
          <Copy size={20} weight="displayMedium">
            {title}
          </Copy>
          <Copy size={14} muted>
            {open.length}
          </Copy>
        </Line>
      }
      actions={
        <Line style={{ gap: 0 }}>
          <IconTap
            size={40}
            icon={Search}
            label="Search"
            onPress={() => go("/tasks/search")}
          />
          {list && (
            <IconTap
              size={40}
              icon={Pencil}
              label="Edit list"
              onPress={() => setEdit(true)}
            />
          )}
        </Line>
      }
    >
      <Line
        style={{
          marginTop: 4,
          paddingHorizontal: 12,
          gap: 8,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: border(t.line, 0.6),
          backgroundColor: t.card,
        }}
      >
        <Plus size={16} color={t.tsk} />
        <TextInput
          ref={input}
          accessibilityLabel={shopping ? "Add item" : "Add task"}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          returnKeyType="done"
          placeholder={shopping ? "Add item" : `Add to ${title}`}
          placeholderTextColor={t.muted}
          style={{
            height: 48,
            flex: 1,
            fontFamily: fonts.body,
            fontSize: 16,
            color: t.text,
          }}
        />
        {!!text && (
          <Tap onPress={add}>
            <Copy size={14} weight="semibold" style={{ color: t.tsk }}>
              Add
            </Copy>
          </Tap>
        )}
      </Line>
      {!shopping && open.length > 0 && (
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "due", label: "By due" },
            { value: "created", label: "Newest" },
            { value: "manual", label: "Manual" },
          ]}
        />
      )}
      {!open.length && !cart.length ? (
        <Empty
          title="Nothing here"
          detail={
            shopping
              ? "Add what you need — tick items off in the store."
              : "Tap the field above to add the first one."
          }
          action={
            <Button tone="quiet" onPress={() => input.current?.focus()}>
              {shopping ? "Add an item" : "Add a task"}
            </Button>
          }
        />
      ) : (
        <View style={{ marginTop: -4 }}>
          {open.map((task) => (
            <Line key={task.id} style={{ gap: 4 }}>
              <View style={{ flex: 1 }}>
                <TaskRow
                  task={task}
                  compact
                  showDay
                  showActions
                  showList={false}
                />
              </View>
              {sort === "manual" && !shopping && (
                <View>
                  <IconTap
                    size={28}
                    icon={ArrowUp}
                    label={`Move ${task.title} up`}
                    onPress={() =>
                      A.moveTask(
                        task.id,
                        -1,
                        open.map((t) => t.id),
                      )
                    }
                  />
                  <IconTap
                    size={28}
                    icon={ArrowDown}
                    label={`Move ${task.title} down`}
                    onPress={() =>
                      A.moveTask(
                        task.id,
                        1,
                        open.map((t) => t.id),
                      )
                    }
                  />
                </View>
              )}
            </Line>
          ))}
          {!open.length && shopping && (
            <Copy
              size={14}
              muted
              style={{ textAlign: "center", paddingVertical: 16 }}
            >
              Everything's in the cart 🛒
            </Copy>
          )}
        </View>
      )}
      {!!cart.length && (
        <View style={{ marginTop: -12 }}>
          <SectionHeading
            action={
              <Tap
                onPress={() => {
                  const cleared = A.clearChecked(id)
                  undo(`Cleared ${cleared.length} items`, () =>
                    A.unclear(cleared),
                  )
                }}
              >
                <Copy size={12} weight="medium" style={{ color: t.tsk }}>
                  Clear checked
                </Copy>
              </Tap>
            }
          >
            In cart · {cart.length}
          </SectionHeading>
          {cart.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              compact
              showDay
              showActions
              showList={false}
            />
          ))}
        </View>
      )}
      {!!done.length && (
        <>
          <Tap
            onPress={() => setShowDone(!showDone)}
            style={{ marginTop: 12, paddingHorizontal: 4 }}
          >
            <Line style={{ gap: 4 }}>
              <ChevronRight
                size={16}
                color={t.muted}
                style={{ transform: [{ rotate: showDone ? "90deg" : "0deg" }] }}
              />
              <Copy
                size={12}
                muted
                weight="medium"
                style={{ letterSpacing: 0.6 }}
              >
                COMPLETED · {done.length}
              </Copy>
            </Line>
          </Tap>
          {showDone &&
            done.slice(0, 30).map((task) => (
              <Line key={task.id}>
                <View style={{ flex: 1 }}>
                  <TaskRow
                    task={task}
                    compact
                    showDay
                    showActions
                    showList={false}
                  />
                </View>
                <Copy size={11} muted style={{ width: 56, textAlign: "right" }}>
                  {L.doneDay(task)?.slice(5)}
                </Copy>
              </Line>
            ))}
        </>
      )}
      {edit && list && (
        <ListEditor list={list} onClose={() => setEdit(false)} />
      )}
    </Screen>
  )
}
