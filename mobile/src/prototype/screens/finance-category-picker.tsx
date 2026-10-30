// Choosing a transaction's category: each main category followed by its
// own sub-categories, and adding one without leaving the sheet.
import type { FinState } from "@domain/finance/data"
import { finStore } from "@domain/finance/store"
import { Check } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Line, Tap } from "../native-kit"
import { useTheme } from "../theme"
import { Button, Field } from "../ui"
import { CategoryForm } from "./finance-categories"

/** The categories of ``kind`` in picking order: each main category, then
 * its sub-categories. A search keeps a matching sub-category's parent
 * above it. A sub-category whose parent is gone is listed as a main one. */
export function pickerRows(
  s: Pick<FinState, "categories">,
  kind: "expense" | "income",
  query = "",
) {
  const cats = s.categories.filter((c) => !c.archived && c.kind === kind),
    tops = cats.filter(
      (c) => !c.parentId || !cats.some((p) => p.id === c.parentId),
    ),
    q = query.trim().toLowerCase(),
    hit = (c: { name: string }) => c.name.toLowerCase().includes(q)
  return {
    tops,
    rows: tops.flatMap((top) => {
      const kids = cats.filter((c) => c.parentId === top.id),
        shown = q && !hit(top) ? kids.filter(hit) : kids
      return !q || hit(top) || shown.length
        ? [{ c: top, sub: false }, ...shown.map((c) => ({ c, sub: true }))]
        : []
    }),
  }
}

export function CategoryPicker({
  kind,
  value,
  onPick,
}: {
  kind: "expense" | "income"
  value: string
  /** A category was chosen, or added (and so chosen). */
  onPick: (id: string) => void
}) {
  const s = finStore.use((s) => s),
    t = useTheme(),
    [query, setQuery] = useState(""),
    // Adding a category here: under which main one, if any.
    [adding, setAdding] = useState<{ parentId?: string } | null>(null),
    { tops, rows: pickRows } = pickerRows(s, kind, query),
    chosen = s.categories.find((c) => c.id === value),
    category = value
  if (adding)
    return (
      <CategoryForm
        catKind={kind}
        parentId={adding.parentId}
        lockKind
        onAdded={onPick}
        onClose={() => setAdding(null)}
      />
    )
  return (
    <>
      <Field label="Search categories" value={query} onChangeText={setQuery} />
      {pickRows.map(({ c, sub }) => (
        <Line key={c.id} style={{ gap: 0 }}>
          {sub && (
            // A sub-category hangs off its parent: an elbow in the
            // gutter where the parent's icon sits.
            <View
              style={{
                width: 28,
                alignSelf: "stretch",
                marginLeft: 10,
                borderLeftWidth: 1,
                borderColor: t.line,
              }}
            />
          )}
          <Tap
            label={
              sub
                ? `${c.name}, under ${s.categories.find((p) => p.id === c.parentId)?.name}`
                : c.name
            }
            onPress={() => {
              onPick(c.id)
            }}
            style={{ flex: 1, paddingVertical: sub ? 10 : 12 }}
          >
            <Line>
              <Copy size={sub ? 16 : 20}>{c.icon}</Copy>
              <Copy
                size={sub ? 14 : 16}
                weight={sub ? "body" : "medium"}
                style={{ flex: 1 }}
              >
                {c.name}
              </Copy>
              {category === c.id && <Check color={t.fin} size={20} />}
            </Line>
          </Tap>
        </Line>
      ))}
      {!pickRows.length && (
        <Copy size={14} muted style={{ paddingVertical: 8 }}>
          No category matches “{query.trim()}”.
        </Copy>
      )}
      <Line style={{ gap: 8, marginTop: 8 }}>
        <View style={{ flex: 1 }}>
          <Button tone="quiet" onPress={() => setAdding({})}>
            New category
          </Button>
        </View>
        {tops.length > 0 && (
          <View style={{ flex: 1 }}>
            <Button
              tone="quiet"
              onPress={() =>
                setAdding({
                  parentId: (chosen?.parentId ?? chosen?.id) || tops[0].id,
                })
              }
            >
              New sub-category
            </Button>
          </View>
        )}
      </Line>
    </>
  )
}
