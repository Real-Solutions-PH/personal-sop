import * as A from "@domain/fitness/actions"
import { lastOfTemplate, relDay } from "@domain/fitness/calc"
import type { TemplateItem } from "@domain/fitness/data"
import { fitStore } from "@domain/fitness/store"
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  LayoutList,
  Minus,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react-native"
import { useState } from "react"
import { TextInput, View } from "react-native"
import { toast } from "sonner-native"
import {
  border,
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  Tap,
} from "../native-kit"
import { go } from "../navigation"
import { fonts, useTheme } from "../theme"
import { Button, Empty, Screen, Sheet, undo } from "../ui"
export function Templates({ id }: { id?: string }) {
  const s = fitStore.use((s) => s),
    t = useTheme(),
    existing = s.templates.find((x) => x.id === id),
    [name, setName] = useState(existing?.name ?? ""),
    [items, setItems] = useState<TemplateItem[]>(existing?.items ?? []),
    [picker, setPicker] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState("")
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const save = () => {
    const result = A.upsertTemplate({
      id: existing?.id,
      name: name.trim() || "Untitled",
      items,
    })
    toast.success("Template saved")
    return result
  }
  if (!id)
    return (
      <Screen
        title="Templates"
        actions={
          <IconTap
            size={40}
            icon={Plus}
            label="New template"
            onPress={() => go("/fitness/templates/new")}
          />
        }
      >
        <View style={{ marginTop: 4 }}>
          {s.templates.map((template) => {
            const last = lastOfTemplate(s, template.id)
            return (
              <Tap
                key={template.id}
                onPress={() => go(`/fitness/templates/${template.id}`)}
                style={{ paddingHorizontal: 4, paddingVertical: 12 }}
              >
                <Line>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${t.fit}26`,
                    }}
                  >
                    <LayoutList size={20} color={t.fit} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Copy weight="medium">{template.name}</Copy>
                    <Copy size={14} muted>
                      {template.items.length} exercises ·{" "}
                      {template.items.reduce((a, i) => a + i.sets, 0)} sets ·{" "}
                      {last ? `last ${relDay(last.startedAt)}` : "never used"}
                    </Copy>
                  </View>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              </Tap>
            )
          })}
        </View>
        {!s.templates.length && (
          <Empty
            title="No templates yet"
            detail="Save a workout as a template from its detail screen, or build one here."
            action={
              <Button onPress={() => go("/fitness/templates/new")}>
                New template
              </Button>
            }
          />
        )}
      </Screen>
    )
  if (id !== "new" && !existing)
    return (
      <Screen title="Template">
        <Empty title="Template not found" />
      </Screen>
    )
  return (
    <Screen
      title={existing ? "Edit template" : "New template"}
      actions={
        // The header row insets actions by 8pt (sized for glyph buttons);
        // a filled pill needs the extra 8pt to sit on the 16pt gutter.
        <View style={{ marginRight: 8 }}>
          <Button
            small
            disabled={!items.length}
            onPress={() => {
              save()
              go("/fitness/templates")
            }}
          >
            Save
          </Button>
        </View>
      }
    >
      <TextInput
        accessibilityLabel="Template name"
        value={name}
        onChangeText={setName}
        placeholder="Template name (e.g. Push B)"
        placeholderTextColor={t.muted}
        style={{
          height: 48,
          paddingHorizontal: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: t.line,
          fontFamily: fonts.body,
          fontSize: 18,
          color: t.text,
        }}
      />
      <View style={{ marginTop: -12 }}>
        <SectionHeading>Exercises</SectionHeading>
        {!items.length ? (
          <Frame style={{ padding: 16 }}>
            <Copy size={14} muted style={{ textAlign: "center" }}>
              An empty template can’t be saved — add at least one exercise.
            </Copy>
          </Frame>
        ) : (
          <Frame>
            {items.map((item, i) => (
              <Line
                key={`${item.exerciseId}-${i}`}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  gap: 8,
                  borderTopWidth: i ? 1 : 0,
                  borderColor: border(t.line, 0.6),
                }}
              >
                <View>
                  <IconTap
                    size={20}
                    icon={ArrowUp}
                    label={`Move ${s.exercises.find((e) => e.id === item.exerciseId)?.name} up`}
                    color={i ? t.muted : border(t.muted, 0.3)}
                    onPress={() => move(i, -1)}
                  />
                  <IconTap
                    size={20}
                    icon={ArrowDown}
                    label={`Move ${s.exercises.find((e) => e.id === item.exerciseId)?.name} down`}
                    color={
                      i === items.length - 1 ? border(t.muted, 0.3) : t.muted
                    }
                    onPress={() => move(i, 1)}
                  />
                </View>
                <Copy weight="medium" lines={1} style={{ flex: 1 }}>
                  {s.exercises.find((e) => e.id === item.exerciseId)?.name}
                </Copy>
                <Line style={{ gap: 4 }}>
                  <IconTap
                    size={32}
                    icon={Minus}
                    background={t.soft}
                    label="Fewer sets"
                    onPress={() =>
                      setItems(
                        items.map((x, j) =>
                          j === i ? { ...x, sets: Math.max(1, x.sets - 1) } : x,
                        ),
                      )
                    }
                  />
                  <Copy size={14} style={{ width: 48, textAlign: "center" }}>
                    {item.sets} sets
                  </Copy>
                  <IconTap
                    size={32}
                    icon={Plus}
                    background={t.soft}
                    label="More sets"
                    onPress={() =>
                      setItems(
                        items.map((x, j) =>
                          j === i
                            ? { ...x, sets: Math.min(10, x.sets + 1) }
                            : x,
                        ),
                      )
                    }
                  />
                </Line>
                <IconTap
                  size={20}
                  icon={X}
                  label="Remove exercise"
                  onPress={() => setItems(items.filter((_, j) => j !== i))}
                />
              </Line>
            ))}
          </Frame>
        )}
      </View>
      <Button
        tone="quiet"
        icon={Plus}
        onPress={() => {
          setSelected([])
          setPicker(true)
        }}
      >
        Add exercise
      </Button>
      {existing && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <Button
            icon={Play}
            disabled={!items.length}
            onPress={() => {
              const result = save(),
                r = A.startWorkout({ from: "template", templateId: result.id })
              if (r.ok) go("/fitness/workout")
              else toast.error(r.reason)
            }}
          >
            Start this template
          </Button>
          <Tap
            onPress={() => {
              const del = A.deleteTemplate(existing.id)
              go("/fitness/templates")
              if (del) undo(`Deleted ${del.name}`, () => A.upsertTemplate(del))
            }}
            style={{
              height: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Line style={{ gap: 8 }}>
              <Trash2 size={16} color={t.bad} />
              <Copy size={14} weight="medium" style={{ color: t.bad }}>
                Delete template
              </Copy>
            </Line>
          </Tap>
        </View>
      )}
      <Sheet
        title="Add exercises"
        open={picker}
        onClose={() => setPicker(false)}
      >
        <TextInput
          accessibilityLabel="Search exercises"
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={t.muted}
          style={{
            height: 40,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 8,
            paddingHorizontal: 12,
            fontFamily: fonts.body,
            color: t.text,
          }}
        />
        {s.exercises
          .filter(
            (e) =>
              !e.archived &&
              e.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .map((e) => (
            <Tap
              key={e.id}
              onPress={() =>
                setSelected(
                  selected.includes(e.id)
                    ? selected.filter((x) => x !== e.id)
                    : [...selected, e.id],
                )
              }
              style={{ paddingVertical: 8 }}
            >
              <Line>
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    borderWidth: 1,
                    borderColor: selected.includes(e.id) ? t.fit : t.line,
                    backgroundColor: selected.includes(e.id)
                      ? t.fit
                      : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {selected.includes(e.id) && <Check size={16} color={t.bg} />}
                </View>
                <View>
                  <Copy weight="medium">{e.name}</Copy>
                  <Copy size={12} muted>
                    {e.muscle} · {e.equipment}
                  </Copy>
                </View>
              </Line>
            </Tap>
          ))}
        <Button
          disabled={!selected.length}
          onPress={() => {
            setItems([
              ...items,
              ...selected.map((exerciseId) => ({ exerciseId, sets: 3 })),
            ])
            setPicker(false)
          }}
        >
          {`Add ${selected.length || ""} exercises`}
        </Button>
      </Sheet>
    </Screen>
  )
}
