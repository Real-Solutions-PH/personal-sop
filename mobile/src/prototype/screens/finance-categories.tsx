import * as A from "@domain/finance/actions"
import type { Category } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { Plus } from "lucide-react-native"
import { useState } from "react"
import { ScrollView, View } from "react-native"
import { toast } from "sonner-native"
import { DragHandle } from "../drag-handle"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  Segmented,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, Choices, confirm, Field, Screen, Sheet, undo } from "../ui"
import { FinChip } from "./finance-projection"

const EMOJI = [
  "🍽️",
  "☕",
  "🛒",
  "🚗",
  "🏠",
  "💡",
  "📶",
  "🎬",
  "🛍️",
  "🎟️",
  "💊",
  "🎁",
  "🐶",
  "📚",
  "✈️",
  "🏋️",
  "👶",
  "🏷️",
]
type EditorProps = {
  id?: string
  catKind?: "expense" | "income"
  parentId?: string
  onClose: () => void
  /** A category was added (not edited): its id. */
  onAdded?: (id: string) => void
  /** The kind is the caller's (a transaction's): no Expense / Income
   * switch. */
  lockKind?: boolean
  /** A new category's name to start from (what the picker was searching). */
  presetName?: string
}
/** The add / edit category sheet. */
export function CategoryEditor(props: EditorProps) {
  const s = finStore.use((s) => s),
    ex = s.categories.find((c) => c.id === props.id),
    [deleting, setDeleting] = useState<string | null>(null)
  return (
    <Sheet
      title={
        deleting
          ? `Delete ${deleting}?`
          : ex
            ? "Edit category"
            : props.parentId
              ? "New sub-category"
              : "New category"
      }
      open
      onClose={props.onClose}
    >
      <CategoryForm {...props} onDeleting={setDeleting} />
    </Sheet>
  )
}
/** The category fields, for the sheet above and inline wherever a category
 * is picked (the transaction editor's picker adds one without leaving). */
export function CategoryForm({
  id,
  catKind = "expense",
  parentId,
  onClose,
  onAdded,
  onDeleting,
  lockKind = false,
  presetName,
}: EditorProps & {
  /** The form switched to (name) or back from (null) the delete step. */
  onDeleting?: (name: string | null) => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    ex = s.categories.find((c) => c.id === id),
    pre = s.categories.find((c) => c.id === parentId),
    [name, setName] = useState(ex?.name ?? presetName ?? ""),
    [kind, setKind] = useState(ex?.kind ?? pre?.kind ?? catKind),
    [parent, setParent] = useState(ex?.parentId ?? pre?.id ?? ""),
    [icon, setIcon] = useState(ex?.icon ?? "🏷️"),
    [disc, setDisc] = useState(ex?.discretionary ?? pre?.discretionary ?? true),
    [deleting, setDeletingState] = useState(false),
    setDeleting = (on: boolean) => {
      setDeletingState(on)
      onDeleting?.(on && ex ? ex.name : null)
    },
    [to, setTo] = useState(""),
    uses = ex
      ? A.categoryUses(s, ex.id)
      : { records: 0, planned: 0, budgets: 0 },
    targets = s.categories.filter(
      (c) =>
        c.kind === kind &&
        c.id !== id &&
        c.parentId !== id &&
        !c.archived &&
        !c.system,
    ),
    parents = s.categories.filter(
      (c) =>
        c.kind === kind &&
        !c.parentId &&
        !c.archived &&
        !c.system &&
        c.id !== id,
    )
  const remove = () => {
    if (!ex) return
    if (uses.records + uses.planned + uses.budgets > 0) {
      setDeleting(true)
      return
    }
    confirm(
      `Delete ${ex.name}?`,
      "Nothing uses it. Its sub-categories will become main categories.",
      () => {
        undo(`${ex.name} deleted`, A.deleteCategoryMoving(ex.id))
        onClose()
      },
    )
  }
  return (
    <>
      {deleting ? (
        <>
          <Copy size={14} muted>
            It's used in {uses.records} transactions, {uses.planned} scheduled
            payments and {uses.budgets} budgets. Move them to:
          </Copy>
          <Choices
            value={to}
            onChange={setTo}
            options={targets.map((c) => ({
              value: c.id,
              label: `${c.icon} ${c.name}`,
            }))}
          />
          <Button
            tone="danger"
            disabled={!to}
            onPress={() => {
              if (!ex || !to) return
              undo(`${ex.name} deleted`, A.deleteCategoryMoving(ex.id, to))
              onClose()
            }}
          >
            Move & delete
          </Button>
          <Button tone="quiet" onPress={() => setDeleting(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {ex && (
            <Copy size={14} muted>
              Used in {uses.records} transactions
            </Copy>
          )}
          <Field label="Name" value={name} onChangeText={setName} />
          {!ex && !pre && !lockKind && (
            <>
              <Copy size={12} muted>
                Type
              </Copy>
              <Segmented
                value={kind}
                onChange={(v) => {
                  setKind(v)
                  setParent("")
                }}
                options={[
                  { value: "expense", label: "Expense" },
                  { value: "income", label: "Income" },
                ]}
              />
            </>
          )}
          <Copy size={12} muted>
            Icon
          </Copy>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {EMOJI.map((e) => (
              <Tap
                key={e}
                label={`Icon ${e}`}
                onPress={() => setIcon(e)}
                style={{
                  width: "10.1%",
                  aspectRatio: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                  backgroundColor:
                    icon === e ? `${t.fin}33` : border(t.soft, 0.5),
                  borderWidth: icon === e ? 1 : 0,
                  borderColor: t.fin,
                }}
              >
                <Copy size={18}>{e}</Copy>
              </Tap>
            ))}
          </View>
          <Copy size={12} muted>
            Sub-category of
          </Copy>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Line style={{ gap: 8 }}>
              <FinChip
                label="None — main category"
                active={!parent}
                onPress={() => setParent("")}
              />
              {parents.map((p) => (
                <FinChip
                  key={p.id}
                  label={`${p.icon} ${p.name}`}
                  active={parent === p.id}
                  onPress={() => setParent(p.id)}
                />
              ))}
            </Line>
          </ScrollView>
          {kind === "expense" && (
            <Line style={{ paddingVertical: 12 }}>
              <View style={{ flex: 1 }}>
                <Copy size={14} weight="medium">
                  Want
                </Copy>
                <Copy size={12} muted>
                  Spending on wants breaks a no-spend day. Turn off for bills
                  and essentials.
                </Copy>
              </View>
              <Switch
                label="Want"
                accent="fin"
                value={disc}
                onChange={setDisc}
              />
            </Line>
          )}
          <Line style={{ gap: 8 }}>
            {ex && (
              <Button tone="danger" onPress={remove}>
                Delete
              </Button>
            )}
            <View style={{ flex: 1 }}>
              <Button
                onPress={() => {
                  if (!name.trim()) {
                    toast.error("Give it a name")
                    return
                  }
                  const twin = s.categories.find(
                    (c) =>
                      c.id !== id &&
                      !c.archived &&
                      c.kind === kind &&
                      (c.parentId ?? "") === parent &&
                      c.name.trim().toLowerCase() === name.trim().toLowerCase(),
                  )
                  if (twin) {
                    toast.error(`You already have “${twin.name}” here`)
                    return
                  }
                  const input = {
                    name: name.trim(),
                    kind,
                    parentId: parent || undefined,
                    icon,
                    discretionary: kind === "expense" && disc,
                  }
                  if (ex) A.updateCategory(ex.id, input)
                  else onAdded?.(A.addCategory(input).id)
                  onClose()
                }}
              >
                Save
              </Button>
            </View>
          </Line>
        </>
      )}
    </>
  )
}
export function Categories() {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [kind, setKind] = useState<"expense" | "income">("expense"),
    [edit, setEdit] = useState<{ id?: string; parentId?: string } | null>(null),
    live = s.categories.filter(
      (c) => c.kind === kind && !c.archived && !c.system,
    ),
    tops = live.filter((c) => !c.parentId),
    subs = (id: string) => live.filter((c) => c.parentId === id),
    archived = s.categories.filter((c) => c.archived).length,
    usage = (id: string) => s.records.filter((r) => r.categoryId === id).length,
    rows = tops.flatMap((c) => [
      { type: "main", c },
      ...subs(c.id).map((c) => ({ type: "sub", c })),
      { type: "add", c },
    ])
  const move = (from: number, delta: number) => {
    const row = rows[from]
    if (row.type !== "sub" || !delta) return
    const to = Math.max(1, Math.min(rows.length - 1, from + delta)),
      next = [...rows]
    next.splice(from, 1)
    next.splice(to, 0, row)
    let parent: Category | undefined
    for (let i = to - 1; i >= 0 && !parent; i--)
      if (next[i].type === "main") parent = next[i].c
    if (!parent) return
    const after = next[to + 1],
      restore = A.moveSubCategory(
        row.c.id,
        parent.id,
        after?.type === "sub" ? after.c.id : undefined,
      )
    if (parent.id !== row.c.parentId)
      undo(`Moved ${row.c.name} to ${parent.name}`, restore)
  }
  const body = (c: Category, count: number, kids = 0) => (
    <>
      <Tap
        onPress={() => setEdit({ id: c.id })}
        style={{ flex: 1, minHeight: 44 }}
      >
        <Line>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: t.soft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Copy size={18}>{c.icon}</Copy>
          </View>
          <View style={{ flex: 1 }}>
            <Copy weight="medium">{c.name}</Copy>
            <Copy size={12} muted>
              {count} transaction{count === 1 ? "" : "s"}
              {kids ? ` · ${kids} sub-categor${kids === 1 ? "y" : "ies"}` : ""}
            </Copy>
          </View>
        </Line>
      </Tap>
      {kind === "expense" && (
        <Tap
          label={`${c.name}: ${c.discretionary ? "want" : "need"}. Switch to ${c.discretionary ? "need" : "want"}`}
          onPress={() =>
            A.updateCategory(c.id, { discretionary: !c.discretionary })
          }
          style={{
            borderRadius: 20,
            paddingHorizontal: 10,
            paddingVertical: 4,
            backgroundColor: c.discretionary ? `${t.fin}26` : t.soft,
          }}
        >
          <Copy
            size={11}
            weight="medium"
            style={{ color: c.discretionary ? t.fin : t.muted }}
          >
            {c.discretionary ? "want" : "need"}
          </Copy>
        </Tap>
      )}
    </>
  )
  return (
    <Screen
      title="Categories"
      actions={
        <IconTap
          icon={Plus}
          label="Add category"
          size={40}
          color={t.text}
          onPress={() => setEdit({})}
        />
      }
    >
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
      />
      <Copy size={12} muted style={{ paddingHorizontal: 4 }}>
        {kind === "expense"
          ? "Wants break a no-spend day. Tap the tag to switch want/need. "
          : ""}
        Drag a sub-category by its grip to move it under another category.
      </Copy>
      <Frame style={{ padding: 4 }}>
        {rows.map((r, i) =>
          r.type === "main" ? (
            <Line
              key={`main-${r.c.id}`}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderTopWidth: i ? 1 : 0,
                borderColor: border(t.line, 0.5),
              }}
            >
              {body(
                r.c,
                usage(r.c.id) +
                  subs(r.c.id).reduce((a, c) => a + usage(c.id), 0),
                subs(r.c.id).length,
              )}
            </Line>
          ) : r.type === "add" ? (
            <Tap
              key={`add-${r.c.id}`}
              label={`Add sub-category to ${r.c.name}`}
              onPress={() => setEdit({ parentId: r.c.id })}
              style={{
                height: 44,
                paddingLeft: 56,
                paddingRight: 12,
                justifyContent: "center",
              }}
            >
              <Line style={{ gap: 8 }}>
                <Plus size={16} color={t.muted} />
                <Copy size={14} muted>
                  Add sub-category
                </Copy>
              </Line>
            </Tap>
          ) : (
            <Line
              key={`sub-${r.c.id}`}
              style={{
                paddingLeft: 8,
                paddingRight: 12,
                paddingVertical: 4,
                gap: 4,
              }}
            >
              <DragHandle
                name={r.c.name}
                rowHeight={52}
                onMove={(d) => move(i, d)}
              />
              <Line style={{ flex: 1 }}>{body(r.c, usage(r.c.id))}</Line>
            </Line>
          ),
        )}
        <Tap
          label={`Add ${kind} category`}
          onPress={() => setEdit({})}
          style={{
            height: 48,
            paddingHorizontal: 12,
            justifyContent: "center",
            borderTopWidth: rows.length ? 1 : 0,
            borderColor: border(t.line, 0.5),
          }}
        >
          <Line style={{ gap: 8 }}>
            <Plus size={16} color={t.text} />
            <Copy size={14} weight="medium">
              Add category
            </Copy>
          </Line>
        </Tap>
      </Frame>
      {archived > 0 && (
        <Tap onPress={() => go("/finance/archived")}>
          <Copy size={14} muted style={{ textAlign: "center" }}>
            Show {archived} archived
          </Copy>
        </Tap>
      )}
      {edit && (
        <CategoryEditor
          {...edit}
          catKind={kind}
          onClose={() => setEdit(null)}
        />
      )}
    </Screen>
  )
}
