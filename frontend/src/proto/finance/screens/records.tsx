"use client"

import {
  CheckSquare,
  CloudOff,
  MessageSquare,
  Plus,
  Search,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { openCapture } from "../../lib/capture"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Money,
  NumberInput,
  Screen,
  Segmented,
} from "../../ui/kit"
import { SwipeAction, SwipeRow } from "../../ui/swipe-row"
import { deleteRecords, recategorise, restoreRecords } from "../actions"
import { acctMap, catMap, dayLabel, recDay, today } from "../calc"
import type { FinRecord, RecordType } from "../data"
import { CategoryPicker } from "../editors"
import { confirmDeleteRecords, openSheet } from "../sheets"
import { useFin } from "../store"
import {
  ChipRow,
  Field,
  FinSheet,
  inputCls,
  LoadingList,
  RecordRow,
  sourceLabel,
  Toggle,
  undoToast,
  useDemoState,
} from "../ui"

export interface RecordFilter {
  type: "all" | RecordType
  accounts: string[]
  cats: string[]
  from: string
  to: string
  min: string
  max: string
  sources: FinRecord["source"][]
  pendingOnly: boolean
  sort: "date" | "amount" | "payee"
}

const EMPTY: RecordFilter = {
  type: "all",
  accounts: [],
  cats: [],
  from: "",
  to: "",
  min: "",
  max: "",
  sources: [],
  pendingOnly: false,
  sort: "date",
}
const VIEW_KEY = "sop-proto:finance-records-view"

function loadDefault(): RecordFilter {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY)
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY
  } catch {
    return EMPTY
  }
}

const activeCount = (f: RecordFilter) =>
  (f.type !== "all" ? 1 : 0) +
  (f.accounts.length ? 1 : 0) +
  (f.cats.length ? 1 : 0) +
  (f.from || f.to ? 1 : 0) +
  (f.min || f.max ? 1 : 0) +
  (f.sources.length ? 1 : 0) +
  (f.pendingOnly ? 1 : 0)

export function RecordsScreen() {
  const s = useFin()
  const sp = useSearchParams()
  const router = useRouter()
  const demo = useDemoState()
  const [q, setQ] = useState(sp.get("q") ?? "")
  const [filter, setFilter] = useState<RecordFilter>(() => {
    const fromUrl = {
      cats: sp.get("cat") ? [sp.get("cat") as string] : [],
      accounts: sp.get("account") ? [sp.get("account") as string] : [],
      from: sp.get("from") ?? "",
      to: sp.get("to") ?? "",
      pendingOnly: sp.get("pending") === "1",
    }
    const anyUrl =
      fromUrl.cats.length ||
      fromUrl.accounts.length ||
      fromUrl.from ||
      fromUrl.pendingOnly
    return anyUrl ? { ...EMPTY, ...fromUrl } : EMPTY
  })
  // saved default view (client only, after hydration)
  useEffect(() => {
    if (
      !sp.get("cat") &&
      !sp.get("account") &&
      !sp.get("from") &&
      !sp.get("pending")
    )
      setFilter(loadDefault())
  }, [sp])
  const [sheet, setSheet] = useState(false)
  const [limit, setLimit] = useState(120)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<string[]>([])
  const [recat, setRecat] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const accts = useMemo(() => acctMap(s), [s])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const f = filter
    const out = s.records.filter((r) => {
      if (f.type !== "all" && r.type !== f.type) return false
      if (
        f.accounts.length &&
        !f.accounts.includes(r.accountId) &&
        !(r.toAccountId && f.accounts.includes(r.toAccountId))
      )
        return false
      if (f.cats.length) {
        const c = cats.get(r.categoryId ?? "")
        if (!c) return false
        if (
          !f.cats.includes(c.id) &&
          !(c.parentId && f.cats.includes(c.parentId))
        )
          return false
      }
      const k = recDay(r)
      if (f.from && k < f.from) return false
      if (f.to && k > f.to) return false
      if (f.min && r.amount < Number(f.min)) return false
      if (f.max && r.amount > Number(f.max)) return false
      if (f.sources.length && !f.sources.includes(r.source)) return false
      if (f.pendingOnly && r.status !== "pending") return false
      if (needle) {
        const hay =
          `${r.payee ?? ""} ${r.note ?? ""} ${r.amount} ${cats.get(r.categoryId ?? "")?.name ?? ""}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    if (f.sort === "amount") out.sort((a, b) => b.amount - a.amount)
    else if (f.sort === "payee")
      out.sort((a, b) => (a.payee ?? "").localeCompare(b.payee ?? ""))
    else out.reverse()
    return out
  }, [s, q, filter, cats])

  const groups = useMemo(() => {
    if (filter.sort !== "date")
      return [{ key: "", rows: rows.slice(0, limit), net: 0 }]
    const g: { key: string; rows: FinRecord[]; net: number }[] = []
    for (const r of rows.slice(0, limit)) {
      const k = recDay(r)
      let cur = g[g.length - 1]
      if (!cur || cur.key !== k) {
        cur = { key: k, rows: [], net: 0 }
        g.push(cur)
      }
      cur.rows.push(r)
      if (!r.isAdjustment)
        cur.net +=
          r.type === "income" ? r.amount : r.type === "expense" ? -r.amount : 0
    }
    return g
  }, [rows, limit, filter.sort])

  const toggleSel = (id: string) =>
    setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]))

  const header = (
    <>
      <button
        type="button"
        aria-label="Select"
        onClick={() => {
          setSelecting(!selecting)
          setSel([])
        }}
        className={cn(
          "grid size-10 place-items-center rounded-full hover:bg-muted",
          selecting && "text-fin",
        )}
      >
        <CheckSquare className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Add transaction"
        onClick={() => openSheet({ kind: "record" })}
        className="grid size-10 place-items-center rounded-full hover:bg-muted"
      >
        <Plus className="size-5" />
      </button>
    </>
  )

  if (demo === "loading")
    return (
      <Screen title="Transactions" back actions={header}>
        <LoadingList rows={8} />
      </Screen>
    )
  if (demo === "error")
    return (
      <Screen title="Transactions" back actions={header}>
        <Empty
          icon={<CloudOff className="size-10" />}
          title="Couldn't load transactions"
          body="You're offline or the server didn't answer. 2 captures are queued and will sync when you're back."
          action={
            <Btn
              accent="fin"
              onClick={() => router.replace("/finance/records")}
            >
              Retry
            </Btn>
          }
        />
      </Screen>
    )
  if (demo === "empty" || s.records.length === 0)
    return (
      <Screen title="Transactions" back actions={header}>
        <Empty
          icon={<MessageSquare className="size-10" />}
          title="No transactions yet"
          body={<>Try saying “lunch 180 gcash” — it's logged instantly.</>}
          action={
            <div className="flex gap-2">
              <Btn
                accent="fin"
                onClick={() => openCapture({ mode: "text", hint: "expense" })}
              >
                Log by chat
              </Btn>
              <Btn
                variant="secondary"
                onClick={() => openSheet({ kind: "quick-add" })}
              >
                Quick add
              </Btn>
            </div>
          }
        />
      </Screen>
    )

  const n = activeCount(filter)
  const total = rows.reduce(
    (x, r) =>
      r.isAdjustment
        ? x
        : x +
          (r.type === "income"
            ? r.amount
            : r.type === "expense"
              ? -r.amount
              : 0),
    0,
  )

  return (
    <Screen title="Transactions" back actions={header}>
      <div className="sticky top-14 z-10 -mx-4 bg-background/90 px-4 pb-2 backdrop-blur-md">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute top-3 left-3 size-4 text-muted-foreground" />
            <input
              className={cn(inputCls, "pl-9")}
              placeholder="Payee, note or amount"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQ("")}
                className="absolute top-3 right-3"
              >
                <X className="size-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSheet(true)}
            className={cn(
              "relative grid size-11 place-items-center rounded-xl border border-border bg-card",
              n && "border-fin text-fin",
            )}
            aria-label="Filter and sort"
          >
            <SlidersHorizontal className="size-4" />
            {n > 0 && (
              <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-fin text-[10px] text-background">
                {n}
              </span>
            )}
          </button>
        </div>
        <div className="mt-2">
          <ChipRow>
            {(["all", "expense", "income", "transfer"] as const).map((t) => (
              <Chip
                key={t}
                accent="fin"
                active={filter.type === t}
                onClick={() => setFilter({ ...filter, type: t })}
                className="h-8 capitalize"
              >
                {t}
              </Chip>
            ))}
            <Chip
              accent="fin"
              active={filter.pendingOnly}
              onClick={() =>
                setFilter({ ...filter, pendingOnly: !filter.pendingOnly })
              }
              className="h-8"
            >
              Needs review
            </Chip>
          </ChipRow>
        </div>
        <div className="mt-1 flex justify-between px-1 text-muted-foreground text-xs">
          <span>
            {rows.length} record{rows.length === 1 ? "" : "s"}
          </span>
          <span>
            Net <Money value={total} signed />
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty
          icon={<Search className="size-8" />}
          title="Nothing matches"
          body="Try a different search or clear the filters."
          action={
            <Btn
              variant="secondary"
              onClick={() => {
                setQ("")
                setFilter(EMPTY)
              }}
            >
              Clear all
            </Btn>
          }
        />
      ) : (
        groups.map((g) => (
          <div key={g.key || "flat"}>
            {g.key && (
              <div className="mt-3 flex justify-between px-1 pb-1 text-muted-foreground text-xs">
                <span className="font-medium">{dayLabel(g.key)}</span>
                <Money value={g.net} signed />
              </div>
            )}
            <Card className="px-2 py-0.5">
              {g.rows.map((r) => (
                // IA FIN-02: swipe to delete, with undo.
                <SwipeRow
                  key={r.id}
                  actions={
                    !selecting && (
                      <SwipeAction
                        onClick={() => {
                          const gone = deleteRecords([r.id])
                          undoToast("Deleted 1 record", () =>
                            restoreRecords(gone),
                          )
                        }}
                        icon={<Trash2 className="size-4" />}
                        label="Delete"
                        className="bg-bad text-white"
                      />
                    )
                  }
                >
                  <RecordRow
                    r={r}
                    cats={cats}
                    accts={accts}
                    selected={selecting && sel.includes(r.id)}
                    onClick={
                      selecting
                        ? () => toggleSel(r.id)
                        : () => router.push(`/finance/records/${r.id}`)
                    }
                  />
                </SwipeRow>
              ))}
            </Card>
          </div>
        ))
      )}
      {rows.length > limit && (
        <Btn
          variant="secondary"
          className="mt-3 w-full"
          onClick={() => setLimit(limit + 120)}
        >
          Show more ({rows.length - limit} older)
        </Btn>
      )}

      {selecting && (
        <div className="sticky bottom-3 z-10 mt-4 flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-xl">
          <span className="flex-1 px-2 text-sm">{sel.length} selected</span>
          <Btn
            variant="secondary"
            disabled={!sel.length}
            onClick={() => setRecat(true)}
          >
            <Tag className="size-4" /> Category
          </Btn>
          <Btn
            variant="danger"
            disabled={!sel.length}
            onClick={() =>
              confirmDeleteRecords(sel, () => {
                setSel([])
                setSelecting(false)
              })
            }
          >
            <Trash2 className="size-4" />
          </Btn>
        </div>
      )}

      <FilterSheet
        open={sheet}
        onOpenChange={setSheet}
        value={filter}
        onApply={setFilter}
      />
      <CategoryPicker
        open={recat}
        onOpenChange={setRecat}
        kind="expense"
        value={[]}
        onChange={(ids) => {
          if (!ids[0]) return
          recategorise(sel, ids[0])
          toast(`Recategorised ${sel.length} transactions`)
          setSel([])
          setSelecting(false)
        }}
      />
    </Screen>
  )
}

// ------------------------------------------------------------------ FIN-08

const SOURCES: FinRecord["source"][] = [
  "chat",
  "quick-add",
  "photo",
  "import",
  "planned",
  "manual",
  "adjustment",
]

export function FilterSheet({
  open,
  onOpenChange,
  value,
  onApply,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  value: RecordFilter
  onApply: (f: RecordFilter) => void
}) {
  const s = useFin()
  const [f, setF] = useState(value)
  const [picker, setPicker] = useState(false)
  const cats = useMemo(() => catMap(s), [s])
  const t = today()
  const preset = (days: number) => {
    const d = new Date(`${t}T12:00:00`)
    d.setDate(d.getDate() - days + 1)
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    setF({ ...f, from, to: t })
  }
  const toggle = <T,>(xs: T[], x: T) =>
    xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]
  return (
    <FinSheet
      open={open}
      onOpenChange={(o) => {
        if (o) setF(value)
        onOpenChange(o)
      }}
      title="Filter & sort"
      footer={
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={() => setF(EMPTY)}>
            Reset
          </Btn>
          <Btn
            variant="secondary"
            onClick={() => {
              try {
                window.localStorage.setItem(VIEW_KEY, JSON.stringify(f))
              } catch {}
              toast("Saved as your default view")
            }}
          >
            Save default
          </Btn>
          <Btn
            accent="fin"
            className="flex-1"
            onClick={() => {
              onApply(f)
              onOpenChange(false)
            }}
          >
            Apply
          </Btn>
        </div>
      }
    >
      <Field label="Sort by">
        <Segmented
          value={f.sort}
          onChange={(v) => setF({ ...f, sort: v })}
          options={[
            { value: "date", label: "Date" },
            { value: "amount", label: "Amount" },
            { value: "payee", label: "Payee" },
          ]}
        />
      </Field>
      <Field label="Date range">
        <ChipRow>
          <Chip onClick={() => preset(7)}>7 days</Chip>
          <Chip onClick={() => preset(30)}>30 days</Chip>
          <Chip onClick={() => preset(90)}>90 days</Chip>
          <Chip onClick={() => setF({ ...f, from: "", to: "" })}>Any</Chip>
        </ChipRow>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="date"
            className={inputCls}
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
          <input
            type="date"
            className={inputCls}
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
        </div>
      </Field>
      <Field label="Accounts">
        <div className="flex flex-wrap gap-2">
          {s.accounts.map((a) => (
            <Chip
              key={a.id}
              accent="fin"
              active={f.accounts.includes(a.id)}
              onClick={() => setF({ ...f, accounts: toggle(f.accounts, a.id) })}
            >
              {a.name}
            </Chip>
          ))}
        </div>
      </Field>
      <Field label="Categories">
        <button
          type="button"
          onClick={() => setPicker(true)}
          className={cn(
            inputCls,
            "flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-2 text-left",
          )}
        >
          {f.cats.length ? (
            f.cats.map((id) => (
              <span
                key={id}
                className="rounded-full bg-fin/15 px-2 py-0.5 text-fin text-xs"
              >
                {cats.get(id)?.icon} {cats.get(id)?.name}
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">Any category</span>
          )}
        </button>
      </Field>
      <Field label="Amount ₱">
        <div className="grid grid-cols-2 gap-2">
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            placeholder="Min"
            value={f.min}
            onChange={(e) =>
              setF({ ...f, min: e.target.value.replace(/[^\d]/g, "") })
            }
          />
          <NumberInput
            inputMode="decimal"
            className={inputCls}
            placeholder="Max"
            value={f.max}
            onChange={(e) =>
              setF({ ...f, max: e.target.value.replace(/[^\d]/g, "") })
            }
          />
        </div>
      </Field>
      <Field label="Source">
        <div className="flex flex-wrap gap-2">
          {SOURCES.map((x) => (
            <Chip
              key={x}
              accent="fin"
              active={f.sources.includes(x)}
              onClick={() => setF({ ...f, sources: toggle(f.sources, x) })}
            >
              {sourceLabel(x)}
            </Chip>
          ))}
        </div>
      </Field>
      <Toggle
        checked={f.pendingOnly}
        onChange={(v) => setF({ ...f, pendingOnly: v })}
        label="Needs review only"
      />
      <CategoryPicker
        open={picker}
        onOpenChange={setPicker}
        kind="expense"
        multi
        value={f.cats}
        onChange={(ids) => setF({ ...f, cats: ids })}
      />
    </FinSheet>
  )
}
