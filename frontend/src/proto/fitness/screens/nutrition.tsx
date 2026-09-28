"use client"

import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Copy,
  History,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  Sparkles,
  Target,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { type ReactNode, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { openCapture } from "../../lib/capture"
import { dayKey } from "../../lib/day"
import {
  Bar,
  Btn,
  Card,
  Chip,
  Empty,
  NumberInput,
  Row,
  Screen,
  SectionTitle,
  Segmented,
  Stat,
} from "../../ui/kit"
import {
  addMealItem,
  answerFollowUp,
  confirmMeal,
  deleteMeal,
  duplicateMeal,
  estimateMeal,
  logMeal,
  reestimateMeal,
  removeMealItem,
  restoreMeal,
  runPendingEstimate,
  setMacroTarget,
  setMealItemMacros,
  setMealItemQty,
  updateMeal,
} from "../actions"
import {
  addDays,
  adherence,
  dayTotals,
  fmtDay,
  fmtTime,
  labelForTime,
  latestBodyweight,
  mealsOn,
  mealTotals,
  relDay,
  sumMacros,
  targetFor,
} from "../calc"
import {
  FOODS,
  type Macros,
  type Meal,
  type MealItem,
  type MealLabel,
} from "../data"
import { fitStore, useFit } from "../store"
import {
  ErrorState,
  LoadingState,
  MacroLine,
  MacroRings,
  Pill,
  Stepper,
  toast,
  useViewState,
} from "../ui"

// FIT-15 Nutrition day · FIT-16/17 Meal review/detail · manual meal form · FIT-18 Targets · FIT-25 History

const LABELS: MealLabel[] = ["breakfast", "lunch", "snack", "dinner"]
const SOURCE_ICON = {
  photo: Camera,
  voice: Mic,
  text: MessageSquare,
  manual: Pencil,
  connector: Sparkles,
}

export function MealThumb({ meal, size = 44 }: { meal: Meal; size?: number }) {
  const Icon = SOURCE_ICON[meal.source]
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-xl",
        meal.photo
          ? "bg-gradient-to-br from-nut/60 via-life/40 to-good/40 text-white"
          : "bg-muted text-muted-foreground",
      )}
      style={{ width: size, height: size }}
    >
      {meal.photo ? (
        <UtensilsCrossed className="size-5" />
      ) : (
        <Icon className="size-5" />
      )}
    </div>
  )
}

function StatusPill({ meal }: { meal: Meal }) {
  if (meal.status === "pending_estimate")
    return (
      <Pill tone="warn">
        <CloudOff className="size-3" /> Estimating when online
      </Pill>
    )
  if (meal.status === "estimated") return <Pill tone="nut">Review</Pill>
  if (meal.source === "connector") return <Pill>via Claude</Pill>
  return null
}

export function LogMealButtons({ day }: { day?: string }) {
  const btns: {
    icon: ReactNode
    label: string
    onClick?: () => void
    href?: string
  }[] = [
    {
      icon: <Camera className="size-5" />,
      label: "Photo",
      onClick: () => openCapture({ mode: "photo", hint: "meal" }),
    },
    {
      icon: <MessageSquare className="size-5" />,
      label: "Chat",
      onClick: () => openCapture({ mode: "text", hint: "meal" }),
    },
    {
      icon: <Mic className="size-5" />,
      label: "Voice",
      onClick: () => openCapture({ mode: "voice", hint: "meal" }),
    },
    {
      icon: <Pencil className="size-5" />,
      label: "Manual",
      href: `/fitness/nutrition/new${day ? `?day=${day}` : ""}`,
    },
  ]
  return (
    <div className="grid grid-cols-4 gap-2">
      {btns.map((b) => {
        const inner = (
          <>
            <span className="grid size-11 place-items-center rounded-2xl bg-nut/15 text-nut">
              {b.icon}
            </span>
            <span className="text-xs">{b.label}</span>
          </>
        )
        return b.href ? (
          <Link
            key={b.label}
            href={b.href}
            className="flex flex-col items-center gap-1 rounded-2xl py-2 active:bg-muted/60"
          >
            {inner}
          </Link>
        ) : (
          <button
            key={b.label}
            type="button"
            onClick={b.onClick}
            className="flex flex-col items-center gap-1 rounded-2xl py-2 active:bg-muted/60"
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}

/** A day's nutrition: switcher, macro rings, log buttons, meals, quick re-log.
 *  Rendered inside Fitness → Eat (the old /fitness/nutrition route redirects there). */
export function NutritionDay() {
  const s = useFit()
  const qs = useSearchParams()
  const router = useRouter()
  const view = useViewState()
  const today = dayKey()
  const day = qs.get("day") ?? today
  const d = useMemo(() => {
    const meals = view === "empty" ? [] : mealsOn(s, day)
    const t =
      view === "empty"
        ? { totals: sumMacros([]), pending: 0, toReview: 0, count: 0 }
        : dayTotals(s, day)
    const seen = new Set<string>()
    const recent = [...s.meals]
      .filter(
        (m) => m.status === "confirmed" && dayKey(new Date(m.eatenAt)) !== day,
      )
      .sort((a, b) => b.eatenAt.localeCompare(a.eatenAt))
      .filter((m) => {
        const k = m.items.map((i) => i.name).join("|")
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .slice(0, 5)
    return { meals, ...t, target: targetFor(s, day), recent }
  }, [s, day, view])
  const go = (k: string) =>
    router.replace(
      k === today ? "/fitness?tab=eat" : `/fitness?tab=eat&day=${k}`,
    )
  return (
    <>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous day"
          onClick={() => go(addDays(day, -1))}
          className="grid size-10 place-items-center rounded-full hover:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-center">
          <div className="font-semibold">
            {day === today ? "Today" : relDay(`${day}T12:00:00`)}
          </div>
          <div className="text-muted-foreground text-xs">{fmtDay(day)}</div>
        </div>
        <button
          type="button"
          aria-label="Next day"
          disabled={day >= today}
          onClick={() => go(addDays(day, 1))}
          className="grid size-10 place-items-center rounded-full hover:bg-muted disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : (
        <>
          <Card className="mt-3">
            <MacroRings totals={d.totals} target={d.target} />
            {d.target ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
                <span className="num">
                  {Math.round(d.totals.kcal)} / {d.target.kcal} kcal · P{" "}
                  {Math.round(d.totals.protein)}/{d.target.protein} g
                </span>
                {!!d.pending && <Pill tone="warn">+{d.pending} pending</Pill>}
                {!!d.toReview && <Pill tone="nut">{d.toReview} to review</Pill>}
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                <span>No targets set — showing totals eaten.</span>
                <Btn
                  accent="nut"
                  className="h-9"
                  href="/fitness/nutrition/targets"
                >
                  Set targets
                </Btn>
              </div>
            )}
          </Card>

          <Card className="mt-3 p-2">
            <LogMealButtons day={day === today ? undefined : day} />
          </Card>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Btn variant="secondary" href="/fitness/nutrition/history">
              <History className="size-4" /> History
            </Btn>
            <Btn variant="secondary" href="/fitness/nutrition/targets">
              <Target className="size-4" /> Targets
            </Btn>
          </div>

          {!d.meals.length ? (
            <Empty
              icon={<UtensilsCrossed className="size-8" />}
              title="Nothing logged — snap your plate"
              body="A photo is enough; AI estimates the macros and you confirm."
              action={
                <Btn
                  accent="nut"
                  onClick={() => openCapture({ mode: "photo", hint: "meal" })}
                >
                  <Camera className="size-4" /> Log a meal
                </Btn>
              }
            />
          ) : (
            LABELS.map((lab) => {
              const ms = d.meals.filter((m) => m.label === lab)
              if (!ms.length) return null
              const tot = sumMacros(
                ms
                  .filter((m) => m.status !== "pending_estimate")
                  .map(mealTotals),
              )
              return (
                <div key={lab}>
                  <SectionTitle
                    action={
                      <span className="num text-muted-foreground text-xs">
                        {Math.round(tot.kcal)} kcal
                      </span>
                    }
                  >
                    <span className="capitalize">{lab}</span>
                  </SectionTitle>
                  <Card className="divide-y divide-border/60 p-0">
                    {ms.map((m) => (
                      <Link
                        key={m.id}
                        href={`/fitness/nutrition/meals/${m.id}`}
                        className="flex items-center gap-3 px-3 py-3 active:bg-muted/60"
                      >
                        <MealThumb meal={m} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-sm">
                            {m.items.length
                              ? m.items
                                  .map((i) => i.name.replace(/\s*\(.*\)/, ""))
                                  .join(", ")
                              : m.rawInput}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs">
                              {fmtTime(m.eatenAt)}
                            </span>
                            <StatusPill meal={m} />
                          </div>
                        </div>
                        {m.status !== "pending_estimate" && (
                          <div className="text-right">
                            <div className="num font-semibold text-sm">
                              {Math.round(mealTotals(m).kcal)}
                            </div>
                            <div className="num text-muted-foreground text-xs">
                              P{Math.round(mealTotals(m).protein)}
                            </div>
                          </div>
                        )}
                      </Link>
                    ))}
                  </Card>
                </div>
              )
            })
          )}

          {!!d.recent.length && (
            <>
              <SectionTitle>Quick re-log</SectionTitle>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {d.recent.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      const c = duplicateMeal(m.id, day)
                      if (c) toast(`Logged ${c.label}`, () => deleteMeal(c.id))
                    }}
                    className="w-40 shrink-0 rounded-2xl border border-border/60 bg-card p-3 text-left active:bg-muted/60"
                  >
                    <div className="line-clamp-2 font-medium text-sm">
                      {m.items
                        .map((i) => i.name.replace(/\s*\(.*\)/, ""))
                        .join(", ")}
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="num text-muted-foreground text-xs">
                        {Math.round(mealTotals(m).kcal)} kcal
                      </span>
                      <Plus className="size-4 text-nut" />
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}

// ── Item editing (shared by review, detail, manual form) ──

function ItemRow({
  it,
  onQty,
  onMacros,
  onRemove,
  readOnly,
}: {
  it: MealItem
  onQty: (q: number) => void
  onMacros: (m: Partial<Macros & { name: string }>) => void
  onRemove: () => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const step = it.unit === "g" ? 25 : 0.5
  return (
    <div className="py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{it.name}</div>
          <MacroLine m={it} />
          {it.assumption && (
            <div className="text-[11px] text-muted-foreground italic">
              AI assumed: {it.assumption}
            </div>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            aria-label="Remove item"
            onClick={onRemove}
            className="text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="Less"
            onClick={() => onQty(Math.max(step, it.qty - step))}
            className="grid size-8 place-items-center rounded-lg bg-muted"
          >
            −
          </button>
          <span className="num min-w-20 text-center text-sm">
            {it.qty} {it.unit}
          </span>
          <button
            type="button"
            aria-label="More"
            onClick={() => onQty(it.qty + step)}
            className="grid size-8 place-items-center rounded-lg bg-muted"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setOpen((x) => !x)}
            className="ml-auto text-nut text-xs"
          >
            {open ? "Done" : "Edit macros"}
          </button>
        </div>
      )}
      {open && !readOnly && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {(["kcal", "protein", "carbs", "fat"] as const).map((k) => (
            <div
              key={k}
              className="text-[10px] text-muted-foreground uppercase"
            >
              {k === "kcal" ? "kcal" : k[0]}
              <NumberInput
                as={Input}
                inputMode="numeric"
                value={it[k]}
                onChange={(e) => onMacros({ [k]: Number(e.target.value) || 0 })}
                className="num mt-0.5 h-9"
                aria-label={k}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FoodPicker({ onPick }: { onPick: (key: string) => void }) {
  const [q, setQ] = useState("")
  const list = FOODS.filter(
    (f) =>
      !q ||
      f.name.toLowerCase().includes(q.toLowerCase()) ||
      f.aliases.some((a) => a.includes(q.toLowerCase())),
  ).slice(0, 8)
  return (
    <div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Add food (adobo, rice, egg…)"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {list.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              onPick(f.key)
              setQ("")
            }}
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs active:bg-muted"
          >
            <Plus className="size-3" /> {f.name.replace(/\s*\(.*\)/, "")}
          </button>
        ))}
      </div>
    </div>
  )
}

export function MealScreen() {
  const { id } = useParams<{ id: string }>()
  const s = useFit()
  const router = useRouter()
  const view = useViewState()
  const meal = s.meals.find((m) => m.id === id)
  const [editing, setEditing] = useState(false)
  const [hint, setHint] = useState("")
  const [hintErr, setHintErr] = useState(false)
  const [estimating, setEstimating] = useState(false)
  if (!meal)
    return (
      <Screen back="/fitness/nutrition" title="Meal">
        <Empty
          title="Meal not found"
          body="It may have been deleted."
          action={
            <Btn variant="secondary" href="/fitness/nutrition">
              Nutrition
            </Btn>
          }
        />
      </Screen>
    )
  const back = `/fitness/nutrition${dayKey(new Date(meal.eatenAt)) === dayKey() ? "" : `?day=${dayKey(new Date(meal.eatenAt))}`}`
  const totals = mealTotals(meal)
  const review = meal.status === "estimated"
  const editable = review || editing
  const failed = view === "error"
  const del = () => {
    const m = deleteMeal(meal.id)
    router.replace(back)
    if (m)
      toast(review ? "Estimate discarded" : "Meal deleted", () =>
        restoreMeal(m),
      )
  }
  const rehint = () => {
    if (!hint.trim()) return
    const ok = reestimateMeal(meal.id, hint)
    setHintErr(!ok)
    if (ok) {
      setHint("")
      if (failed) router.replace(`/fitness/nutrition/meals/${meal.id}`)
    }
  }
  const conf = meal.confidence ?? 0
  return (
    <Screen
      back={back}
      title={
        review ? (
          "Review estimate"
        ) : meal.status === "pending_estimate" ? (
          "Queued photo"
        ) : (
          <span className="capitalize">{meal.label}</span>
        )
      }
      actions={
        meal.status === "confirmed" && (
          <button
            type="button"
            onClick={() => setEditing((x) => !x)}
            className="h-9 rounded-full px-3 font-medium text-nut text-sm"
          >
            {editing ? "Done" : "Edit"}
          </button>
        )
      }
      className="pb-28"
    >
      <div className="flex items-center gap-3">
        <MealThumb meal={meal} size={meal.photo ? 72 : 48} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-muted-foreground text-sm">
            “{meal.rawInput}”
          </div>
          <div className="text-muted-foreground text-xs capitalize">
            {meal.source === "connector"
              ? "via Claude connector"
              : `via ${meal.source}`}{" "}
            · {fmtTime(meal.eatenAt)}
          </div>
        </div>
      </div>

      {failed ? (
        <Card className="mt-4 border-bad/40 bg-bad/10">
          <div className="font-medium">Couldn’t estimate this one</div>
          <div className="text-muted-foreground text-sm">
            Describe it in words, or enter macros manually. Nothing is saved
            until you confirm.
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. 1 cup rice, sinigang na baboy"
            />
            <Btn accent="nut" onClick={rehint}>
              Estimate
            </Btn>
          </div>
          {hintErr && (
            <div className="mt-1 text-bad text-xs">
              Still couldn’t match that — try naming the dishes.
            </div>
          )}
          <Btn
            variant="secondary"
            className="mt-2 w-full"
            href="/fitness/nutrition/new"
          >
            Enter macros manually
          </Btn>
        </Card>
      ) : meal.status === "pending_estimate" ? (
        <Card className="mt-4 text-center">
          <CloudOff className="mx-auto size-8 text-warn" />
          <div className="mt-2 font-medium">Estimating when online</div>
          <div className="text-muted-foreground text-sm">
            Your photo is saved on this device. It won’t count toward today’s
            macros until it’s estimated and confirmed.
          </div>
          <Btn
            accent="nut"
            className="mt-4"
            disabled={estimating}
            onClick={() => {
              setEstimating(true)
              setTimeout(() => {
                runPendingEstimate(meal.id)
                setEstimating(false)
              }, 900)
            }}
          >
            {estimating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}{" "}
            Estimate now
          </Btn>
        </Card>
      ) : (
        <>
          {review && (
            <Card className="mt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium">
                  <Sparkles className="size-4 text-nut" /> AI estimate
                </span>
                <Pill
                  tone={conf >= 0.8 ? "good" : conf >= 0.65 ? "warn" : "bad"}
                >
                  {conf >= 0.8 ? "High" : conf >= 0.65 ? "Medium" : "Low"}{" "}
                  confidence · {Math.round(conf * 100)}%
                </Pill>
              </div>
              <Bar value={conf} accent="nut" className="mt-2 h-1.5" />
              {meal.followUp && (
                <div className="mt-3 rounded-xl bg-muted/60 p-3">
                  <div className="text-sm">{meal.followUp.question}</div>
                  <div className="mt-2 flex gap-2">
                    {meal.followUp.options.map((o) => (
                      <Chip key={o} onClick={() => answerFollowUp(meal.id, o)}>
                        {o}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="kcal" value={Math.round(totals.kcal)} accent="nut" />
            <Stat label="Protein" value={`${Math.round(totals.protein)}g`} />
            <Stat label="Carbs" value={`${Math.round(totals.carbs)}g`} />
            <Stat label="Fat" value={`${Math.round(totals.fat)}g`} />
          </Card>

          <SectionTitle>Items</SectionTitle>
          <Card className="divide-y divide-border/60 py-0">
            {meal.items.map((it) => (
              <ItemRow
                key={it.id}
                it={it}
                readOnly={!editable}
                onQty={(q) => setMealItemQty(meal.id, it.id, q)}
                onMacros={(m) => setMealItemMacros(meal.id, it.id, m)}
                onRemove={() => removeMealItem(meal.id, it.id)}
              />
            ))}
            {!meal.items.length && (
              <div className="py-4 text-center text-muted-foreground text-sm">
                No items — add one below.
              </div>
            )}
          </Card>

          {editable && (
            <>
              <div className="mt-3">
                <FoodPicker onPick={(k) => addMealItem(meal.id, k)} />
              </div>
              <SectionTitle>When</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {LABELS.map((l) => (
                  <Chip
                    key={l}
                    active={meal.label === l}
                    accent="nut"
                    onClick={() => updateMeal(meal.id, { label: l })}
                    className="capitalize"
                  >
                    {l}
                  </Chip>
                ))}
                <Input
                  type="time"
                  aria-label="Time eaten"
                  value={new Date(meal.eatenAt).toTimeString().slice(0, 5)}
                  onChange={(e) => {
                    const d = new Date(meal.eatenAt)
                    const [h, mi] = e.target.value.split(":").map(Number)
                    d.setHours(h, mi)
                    updateMeal(meal.id, { eatenAt: d.toISOString() })
                  }}
                  className="h-9 w-28"
                />
              </div>
            </>
          )}

          {review && (
            <>
              <SectionTitle>Not quite right?</SectionTitle>
              <div className="flex gap-2">
                <Input
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  placeholder="Add a hint: “2 cups rice, fried egg”"
                />
                <Btn variant="secondary" onClick={rehint}>
                  Re-estimate
                </Btn>
              </div>
              {hintErr && (
                <div className="mt-1 text-bad text-xs">
                  Couldn’t match that — try naming the dishes.
                </div>
              )}
            </>
          )}

          {meal.status === "confirmed" && !editing && (
            <div className="mt-5 grid grid-cols-2 gap-2">
              <Btn
                variant="secondary"
                onClick={() => {
                  const c = duplicateMeal(meal.id)
                  if (c) toast("Added to today", () => deleteMeal(c.id))
                }}
              >
                <Copy className="size-4" /> Duplicate to today
              </Btn>
              <Btn variant="danger" onClick={del}>
                <Trash2 className="size-4" /> Delete
              </Btn>
            </div>
          )}
        </>
      )}

      {(review || meal.status === "pending_estimate" || failed) && (
        <div className="sticky bottom-0 mt-6 grid grid-cols-[auto_1fr] gap-2 bg-background/90 py-3 backdrop-blur">
          <Btn variant="ghost" className="text-bad" onClick={del}>
            Discard
          </Btn>
          {review && !failed && (
            <Btn
              accent="nut"
              disabled={!meal.items.length}
              onClick={() => {
                confirmMeal(meal.id)
                toast("Meal confirmed")
                router.replace(back)
              }}
            >
              Confirm · {Math.round(totals.kcal)} kcal
            </Btn>
          )}
        </div>
      )}
    </Screen>
  )
}

export function ManualMealScreen() {
  const qs = useSearchParams()
  const router = useRouter()
  const day = qs.get("day") ?? dayKey()
  const now = new Date()
  const [label, setLabel] = useState<MealLabel>(labelForTime(now))
  const [time, setTime] = useState(now.toTimeString().slice(0, 5))
  const [text, setText] = useState("")
  const [err, setErr] = useState(false)
  const [items, setItems] = useState<MealItem[]>([])
  const [custom, setCustom] = useState({
    name: "",
    kcal: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  })
  const eatenAt = new Date(`${day}T${time}:00`).toISOString()
  const back =
    day === dayKey() ? "/fitness/nutrition" : `/fitness/nutrition?day=${day}`
  const totals = sumMacros(items)
  const scale = (it: MealItem, q: number): MealItem => {
    const f = it.qty ? q / it.qty : 1
    return {
      ...it,
      qty: q,
      kcal: Math.round(it.kcal * f),
      protein: Math.round(it.protein * f),
      carbs: Math.round(it.carbs * f),
      fat: Math.round(it.fat * f),
    }
  }
  return (
    <Screen back={back} title="Log meal" className="pb-28">
      <Card>
        <div className="flex items-center gap-2 font-medium text-sm">
          <Sparkles className="size-4 text-nut" /> Describe it
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setErr(false)
          }}
          placeholder="lunch: 1 cup rice, adobo 2 pcs, softdrinks 1 can"
          className="mt-2 min-h-20 w-full rounded-xl bg-muted/60 p-3 text-sm outline-none"
        />
        {err && (
          <div className="mb-2 text-bad text-xs">
            Couldn’t estimate — name the dishes, or add items manually below.
          </div>
        )}
        <Btn
          accent="nut"
          className="w-full"
          disabled={!text.trim()}
          onClick={() => {
            const m = estimateMeal(text, { source: "text", eatenAt, label })
            if (!m) return setErr(true)
            router.replace(`/fitness/nutrition/meals/${m.id}`)
          }}
        >
          Estimate macros
        </Btn>
      </Card>

      <SectionTitle>Or build it yourself</SectionTitle>
      <div className="flex flex-wrap gap-2">
        {LABELS.map((l) => (
          <Chip
            key={l}
            active={label === l}
            accent="nut"
            onClick={() => setLabel(l)}
            className="capitalize"
          >
            {l}
          </Chip>
        ))}
        <Input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          aria-label="Time"
          className="h-9 w-28"
        />
      </div>
      <div className="mt-3">
        <FoodPicker
          onPick={(k) => {
            const f = FOODS.find((x) => x.key === k)
            if (f)
              setItems((xs) => [
                ...xs,
                {
                  id: `${k}-${xs.length}-${Date.now()}`,
                  name: f.name,
                  qty: f.qty,
                  unit: f.unit,
                  kcal: f.kcal,
                  protein: f.protein,
                  carbs: f.carbs,
                  fat: f.fat,
                },
              ])
          }}
        />
      </div>
      <Card className="mt-3">
        <div className="font-medium text-sm">Custom item</div>
        <Input
          className="mt-2"
          placeholder="Name (e.g. Jollibee Chickenjoy)"
          value={custom.name}
          onChange={(e) => setCustom({ ...custom, name: e.target.value })}
        />
        <div className="mt-2 grid grid-cols-4 gap-2">
          {(["kcal", "protein", "carbs", "fat"] as const).map((k) => (
            <div
              key={k}
              className="text-[10px] text-muted-foreground uppercase"
            >
              {k === "kcal" ? "kcal" : `${k[0]} (g)`}
              <NumberInput
                as={Input}
                inputMode="numeric"
                value={custom[k] || ""}
                onChange={(e) =>
                  setCustom({ ...custom, [k]: Number(e.target.value) || 0 })
                }
                className="num mt-0.5 h-9"
                aria-label={k}
              />
            </div>
          ))}
        </div>
        {!!custom.kcal &&
          !!(custom.protein + custom.carbs + custom.fat) &&
          Math.abs(
            custom.protein * 4 +
              custom.carbs * 4 +
              custom.fat * 9 -
              custom.kcal,
          ) >
            custom.kcal * 0.15 && (
            <div className="mt-1 text-warn text-xs">
              P×4 + C×4 + F×9 ={" "}
              {custom.protein * 4 + custom.carbs * 4 + custom.fat * 9} kcal —
              doesn’t match {custom.kcal}.
            </div>
          )}
        <Btn
          variant="secondary"
          className="mt-2 w-full"
          disabled={!custom.name.trim() || !custom.kcal}
          onClick={() => {
            setItems((xs) => [
              ...xs,
              { id: `c-${Date.now()}`, qty: 1, unit: "serving", ...custom },
            ])
            setCustom({ name: "", kcal: 0, protein: 0, carbs: 0, fat: 0 })
          }}
        >
          <Plus className="size-4" /> Add custom item
        </Btn>
      </Card>

      {!!items.length && (
        <>
          <SectionTitle action={<MacroLine m={totals} />}>
            This meal
          </SectionTitle>
          <Card className="divide-y divide-border/60 py-0">
            {items.map((it) => (
              <ItemRow
                key={it.id}
                it={it}
                onQty={(q) =>
                  setItems((xs) =>
                    xs.map((x) => (x.id === it.id ? scale(x, q) : x)),
                  )
                }
                onMacros={(m) =>
                  setItems((xs) =>
                    xs.map((x) => (x.id === it.id ? { ...x, ...m } : x)),
                  )
                }
                onRemove={() =>
                  setItems((xs) => xs.filter((x) => x.id !== it.id))
                }
              />
            ))}
          </Card>
        </>
      )}

      <div className="sticky bottom-0 mt-6 bg-background/90 py-3 backdrop-blur">
        <Btn
          accent="nut"
          className="w-full"
          disabled={!items.length}
          onClick={() => {
            const m = logMeal({
              items: items.map(({ id: _id, ...rest }) => rest),
              eatenAt,
              label,
            })
            toast(`Logged ${m.label} · ${Math.round(totals.kcal)} kcal`, () =>
              deleteMeal(m.id),
            )
            router.replace(back)
          }}
        >
          Save meal{items.length ? ` · ${Math.round(totals.kcal)} kcal` : ""}
        </Btn>
      </div>
    </Screen>
  )
}

export function TargetsScreen() {
  const s = useFit()
  const router = useRouter()
  const view = useViewState()
  const cur = view === "empty" ? undefined : targetFor(s, dayKey())
  const [t, setT] = useState<Macros>(
    cur ?? { kcal: 2100, protein: 160, carbs: 210, fat: 70 },
  )
  const [sug, setSug] = useState<Macros | null>(null)
  const calc = t.protein * 4 + t.carbs * 4 + t.fat * 9
  const mismatch = Math.abs(calc - t.kcal) > t.kcal * 0.05
  const autoSplit = () => {
    const fat = Math.round((t.kcal * 0.27) / 9)
    const carbs = Math.max(
      0,
      Math.round((t.kcal - t.protein * 4 - fat * 9) / 4),
    )
    setT({ ...t, fat, carbs })
  }
  const suggest = () => {
    const bw = latestBodyweight(fitStore.get()) ?? 75
    const dir = s.settings.goalDirection
    const kcal =
      Math.round((bw * (dir === "cut" ? 27 : dir === "bulk" ? 36 : 32)) / 50) *
      50
    const protein = Math.round(bw * 2.1)
    const fat = Math.round((kcal * 0.27) / 9)
    setSug({
      kcal,
      protein,
      fat,
      carbs: Math.round((kcal - protein * 4 - fat * 9) / 4),
    })
  }
  const history = [...s.targets].sort((a, b) =>
    b.effectiveFrom.localeCompare(a.effectiveFrom),
  )
  return (
    <Screen back="/fitness/nutrition" title="Macro targets" className="pb-28">
      {view === "error" ? (
        <ErrorState />
      ) : (
        <>
          {!cur && (
            <Card className="mb-3 text-sm">
              No targets yet. Enter calories and protein — carbs and fat can
              auto-split.
            </Card>
          )}
          <Card className="space-y-5">
            <Stepper
              label="Calories"
              value={t.kcal}
              onChange={(v) => setT({ ...t, kcal: v })}
              step={50}
              min={800}
              max={6000}
              unit="kcal"
              decimals={0}
            />
            <Stepper
              label="Protein"
              value={t.protein}
              onChange={(v) => setT({ ...t, protein: v })}
              step={5}
              min={0}
              max={500}
              unit="g"
              decimals={0}
            />
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                label="Carbs"
                value={t.carbs}
                onChange={(v) => setT({ ...t, carbs: v })}
                step={5}
                min={0}
                max={900}
                unit="g"
                decimals={0}
              />
              <Stepper
                label="Fat"
                value={t.fat}
                onChange={(v) => setT({ ...t, fat: v })}
                step={5}
                min={0}
                max={300}
                unit="g"
                decimals={0}
              />
            </div>
            <div
              className={cn(
                "rounded-xl p-3 text-sm",
                mismatch ? "bg-warn/15 text-warn" : "bg-good/10 text-good",
              )}
            >
              P×4 + C×4 + F×9 ={" "}
              <span className="num font-semibold">{calc}</span> kcal
              {mismatch
                ? ` — ${calc > t.kcal ? "over" : "under"} your ${t.kcal} by ${Math.abs(calc - t.kcal)}.`
                : " ✓ adds up."}
              {mismatch && (
                <button
                  type="button"
                  onClick={autoSplit}
                  className="ml-1 font-semibold underline"
                >
                  Auto-split carbs/fat
                </button>
              )}
            </div>
          </Card>

          <Card className="mt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Help me pick</div>
                <div className="text-muted-foreground text-xs">
                  From your latest weight and goal (
                  {
                    {
                      cut: "lose weight",
                      maintain: "maintain",
                      bulk: "gain weight",
                    }[s.settings.goalDirection]
                  }
                  ). A starting point, not advice.
                </div>
              </div>
              <Btn variant="secondary" className="h-9" onClick={suggest}>
                <Sparkles className="size-4" /> Suggest
              </Btn>
            </div>
            {sug && (
              <div className="mt-3 flex items-center justify-between rounded-xl bg-nut/10 p-3">
                <span className="num text-sm">
                  {sug.kcal} kcal · P{sug.protein} · C{sug.carbs} · F{sug.fat}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setT(sug)
                    setSug(null)
                  }}
                  className="font-semibold text-nut text-sm"
                >
                  Use
                </button>
              </div>
            )}
          </Card>

          <SectionTitle>History</SectionTitle>
          <Card className="divide-y divide-border/60 p-0">
            {history.map((h, i) => (
              <div
                key={h.id}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {i === 0 ? "Current" : "Previous"}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    from {fmtDay(h.effectiveFrom)}
                  </div>
                </div>
                <span className="num text-muted-foreground">
                  {h.kcal} · P{h.protein} C{h.carbs} F{h.fat}
                </span>
              </div>
            ))}
            {!history.length && (
              <div className="p-4 text-muted-foreground text-sm">
                No targets saved yet.
              </div>
            )}
          </Card>

          <div className="sticky bottom-0 mt-6 bg-background/90 py-3 backdrop-blur">
            <Btn
              accent="nut"
              className="w-full"
              onClick={() => {
                setMacroTarget(t)
                toast("Targets saved — effective today")
                router.replace("/fitness/nutrition")
              }}
            >
              Save · effective today
            </Btn>
          </div>
        </>
      )}
    </Screen>
  )
}

export function NutritionHistoryScreen() {
  const s = useFit()
  const view = useViewState()
  const [range, setRange] = useState<"7" | "14" | "30">("14")
  const a = useMemo(() => adherence(s, Number(range)), [s, range])
  const days = view === "empty" ? [] : [...a.days].reverse()
  return (
    <Screen back="/fitness/nutrition" title="Nutrition history">
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: "7", label: "7 days" },
          { value: "14", label: "14 days" },
          { value: "30", label: "30 days" },
        ]}
      />
      {view === "loading" ? (
        <LoadingState />
      ) : view === "error" ? (
        <ErrorState />
      ) : !days.some((d) => d.meals) ? (
        <Empty
          icon={<UtensilsCrossed className="size-8" />}
          title="No meals logged in this range"
          body="On-target stats appear once you log at least one day."
          action={
            <Btn accent="nut" href="/fitness/nutrition">
              Log today
            </Btn>
          }
        />
      ) : (
        <>
          <Card className="mt-3 grid grid-cols-2 gap-4">
            <Stat
              label="Calories on target"
              value={`${Math.round(a.calorie * 100)}%`}
              accent="nut"
            />
            <Stat
              label="Protein hit rate"
              value={`${Math.round(a.protein * 100)}%`}
            />
            <Stat label="Over-target days" value={a.overDays} />
            <Stat
              label="Days logged"
              value={`${Math.round(a.coverage * 100)}%`}
            />
          </Card>
          {a.coverage < 0.8 && (
            <div className="mt-2 px-1 text-muted-foreground text-xs">
              Logged under 80% of days — these stats are incomplete, not
              perfect.
            </div>
          )}
          <div className="mt-4 space-y-1">
            {days.map((d) => (
              <Row
                key={d.day}
                href={
                  d.day === dayKey()
                    ? "/fitness/nutrition"
                    : `/fitness/nutrition?day=${d.day}`
                }
                title={
                  <div className="flex items-center justify-between gap-2">
                    <span>{fmtDay(d.day)}</span>
                    {d.verdict === "none" ? (
                      <Pill>{d.meals ? "No target" : "Not logged"}</Pill>
                    ) : (
                      <Pill
                        tone={
                          d.verdict === "hit"
                            ? "good"
                            : d.verdict === "over"
                              ? "bad"
                              : "warn"
                        }
                      >
                        {d.verdict === "hit"
                          ? "On target"
                          : d.verdict === "over"
                            ? "Over"
                            : "Under"}
                      </Pill>
                    )}
                  </div>
                }
                subtitle={
                  d.meals ? (
                    <span className="block">
                      <Bar
                        value={d.target ? d.totals.kcal / d.target.kcal : 0}
                        accent="nut"
                        className="my-1 h-1.5"
                      />
                      <span className="num text-xs">
                        {Math.round(d.totals.kcal)}
                        {d.target ? `/${d.target.kcal}` : ""} kcal · P{" "}
                        {Math.round(d.totals.protein)}
                        {d.target ? `/${d.target.protein}` : ""} g{" "}
                        {d.proteinHit ? "✓" : ""}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
            ))}
          </div>
        </>
      )}
    </Screen>
  )
}
