"use client"

import {
  ArrowDown,
  ArrowUp,
  LayoutList,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Btn, Card, Empty, Row, Screen, SectionTitle } from "../../ui/kit"
import { deleteTemplate, startWorkout, upsertTemplate } from "../actions"
import { lastOfTemplate, relDay } from "../calc"
import type { TemplateItem } from "../data"
import { ExercisePicker } from "../sheets"
import { useFit } from "../store"
import { ErrorState, LoadingState, toast, useViewState } from "../ui"

// FIT-13 Templates list · FIT-14 Template editor

export function TemplatesScreen() {
  const s = useFit()
  const view = useViewState()
  const router = useRouter()
  const list = view === "empty" ? [] : s.templates
  return (
    <Screen
      title="Templates"
      back="/fitness?tab=train"
      actions={
        <button
          type="button"
          aria-label="New template"
          onClick={() => router.push("/fitness/templates/new")}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <Plus className="size-5" />
        </button>
      }
    >
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : !list.length ? (
        <Empty
          icon={<LayoutList className="size-8" />}
          title="No templates yet"
          body="Save a workout as a template from its detail screen, or build one here."
          action={
            <Btn accent="fit" href="/fitness/templates/new">
              New template
            </Btn>
          }
        />
      ) : (
        <div className="mt-1">
          {list.map((t) => {
            const last = lastOfTemplate(s, t.id)
            return (
              <Row
                key={t.id}
                href={`/fitness/templates/${t.id}`}
                icon={
                  <div className="grid size-10 place-items-center rounded-xl bg-fit/15 text-fit">
                    <LayoutList className="size-5" />
                  </div>
                }
                title={t.name}
                subtitle={`${t.items.length} exercises · ${t.items.reduce((a, i) => a + i.sets, 0)} sets · ${last ? `last ${relDay(last.startedAt)}` : "never used"}`}
              />
            )
          })}
        </div>
      )}
    </Screen>
  )
}

export function TemplateEditorScreen() {
  const { id } = useParams<{ id: string }>()
  const s = useFit()
  const router = useRouter()
  const existing = s.templates.find((t) => t.id === id)
  const isNew = id === "new"
  if (!existing && !isNew)
    return (
      <Screen back="/fitness/templates" title="Template">
        <Empty
          title="Template not found"
          action={
            <Btn variant="secondary" href="/fitness/templates">
              Templates
            </Btn>
          }
        />
      </Screen>
    )
  return (
    <Editor
      key={id}
      initialName={existing?.name ?? ""}
      initialItems={existing?.items ?? []}
      id={existing?.id}
      onDone={(href) => router.replace(href)}
    />
  )
}

function Editor({
  id,
  initialName,
  initialItems,
  onDone,
}: {
  id?: string
  initialName: string
  initialItems: TemplateItem[]
  onDone: (href: string) => void
}) {
  const s = useFit()
  const [name, setName] = useState(initialName)
  const [items, setItems] = useState<TemplateItem[]>(initialItems)
  const [picker, setPicker] = useState(false)
  const names = useMemo(
    () => new Map(s.exercises.map((e) => [e.id, e.name])),
    [s.exercises],
  )
  const move = (i: number, d: -1 | 1) =>
    setItems((xs) => {
      const c = [...xs]
      const j = i + d
      if (j < 0 || j >= c.length) return xs
      ;[c[i], c[j]] = [c[j], c[i]]
      return c
    })
  const save = () => {
    const t = upsertTemplate({ id, name: name.trim() || "Untitled", items })
    toast("Template saved")
    return t
  }
  return (
    <Screen
      back="/fitness/templates"
      title={id ? "Edit template" : "New template"}
      actions={
        <Btn
          accent="fit"
          className="h-9"
          disabled={!items.length}
          onClick={() => {
            save()
            onDone("/fitness/templates")
          }}
        >
          Save
        </Btn>
      }
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name (e.g. Push B)"
        className="h-12 text-lg"
      />
      <SectionTitle>Exercises</SectionTitle>
      {!items.length ? (
        <Card className="text-center text-muted-foreground text-sm">
          An empty template can’t be saved — add at least one exercise.
        </Card>
      ) : (
        <Card className="divide-y divide-border/60 p-0">
          {items.map((it, i) => (
            <div
              key={`${it.exerciseId}-${i}`}
              className="flex items-center gap-2 px-3 py-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="text-muted-foreground disabled:opacity-30"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === items.length - 1}
                  onClick={() => move(i, 1)}
                  className="text-muted-foreground disabled:opacity-30"
                >
                  <ArrowDown className="size-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1 truncate font-medium">
                {names.get(it.exerciseId)}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Fewer sets"
                  onClick={() =>
                    setItems((xs) =>
                      xs.map((x, j) =>
                        j === i ? { ...x, sets: Math.max(1, x.sets - 1) } : x,
                      ),
                    )
                  }
                  className="grid size-8 place-items-center rounded-lg bg-muted"
                >
                  −
                </button>
                <span className="num w-14 text-center text-sm">
                  {it.sets} sets
                </span>
                <button
                  type="button"
                  aria-label="More sets"
                  onClick={() =>
                    setItems((xs) =>
                      xs.map((x, j) =>
                        j === i ? { ...x, sets: Math.min(10, x.sets + 1) } : x,
                      ),
                    )
                  }
                  className="grid size-8 place-items-center rounded-lg bg-muted"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                aria-label="Remove"
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
                className="text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </Card>
      )}
      <Btn
        variant="secondary"
        className="mt-3 w-full"
        onClick={() => setPicker(true)}
      >
        <Plus className="size-4" /> Add exercise
      </Btn>
      {id && (
        <div className="mt-6 space-y-2">
          <Btn
            accent="fit"
            className="w-full"
            disabled={!items.length}
            onClick={() => {
              const t = save()
              const r = startWorkout({ from: "template", templateId: t.id })
              if (r.ok) onDone("/fitness/workout")
              else toast(r.reason)
            }}
          >
            <Play className="size-4" /> Start this template
          </Btn>
          <Btn
            variant="ghost"
            className="w-full text-bad"
            onClick={() => {
              const del = deleteTemplate(id)
              onDone("/fitness/templates")
              if (del) toast(`Deleted ${del.name}`, () => upsertTemplate(del))
            }}
          >
            <Trash2 className="size-4" /> Delete template
          </Btn>
        </div>
      )}
      <ExercisePicker
        open={picker}
        onOpenChange={setPicker}
        onPick={(ids) =>
          setItems((xs) => [
            ...xs,
            ...ids.map((exerciseId) => ({ exerciseId, sets: 3 })),
          ])
        }
      />
    </Screen>
  )
}
