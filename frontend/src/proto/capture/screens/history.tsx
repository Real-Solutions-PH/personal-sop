"use client"

import {
  AlertTriangle,
  Camera,
  History,
  Mic,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
  WifiOff,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { dayKey, fmtDuration } from "../../lib/day"
import {
  Btn,
  Card,
  Chip,
  Empty,
  Screen,
  SectionTitle,
  Stat,
} from "../../ui/kit"
import {
  deleteCapture,
  processQueue,
  rerunCapture,
  retryCapture,
  sendCapture,
} from "../actions"
import { CaptureCtx, ReplyItemView } from "../cards"
import type { Capture, RecordCard, Target } from "../data"
import { CaptureRow } from "../index"
import { QuickAddSheet } from "../quickadd"
import { captureStore, useOnline } from "../store"
import { toast } from "../toast"
import {
  dayLabel,
  FOCUS,
  KIND_LABEL,
  SOURCE_LABEL,
  TARGET_META,
  Toggle,
  timeLabel,
  tint,
} from "../ui"

// CAP-12 Capture history, CAP-13 Capture detail, CAP-14 Pending/offline queue.

type Filter =
  | "all"
  | "needs"
  | "failed"
  | "undone"
  | "voice"
  | "photo"
  | "quick_add"
  | "connector"

const FILTERS: { v: Filter; label: string }[] = [
  { v: "all", label: "All" },
  { v: "needs", label: "Needs answer" },
  { v: "failed", label: "Failed" },
  { v: "undone", label: "Undone" },
  { v: "voice", label: "Voice" },
  { v: "photo", label: "Photo" },
  { v: "quick_add", label: "Quick add" },
  { v: "connector", label: "Claude" },
]

const recsOf = (c: Capture) =>
  (c.reply?.items ?? []).filter((i): i is RecordCard => i.t === "record")

export function HistoryScreen() {
  const sp = useSearchParams()
  const state = sp.get("state")
  const all = captureStore.use((s) => s.captures)
  const [q, setQ] = useState("")
  const [f, setF] = useState<Filter>((sp.get("source") as Filter) ?? "all")
  const [mod, setMod] = useState<Target | null>(null)

  const list = useMemo(() => {
    if (state === "empty" || state === "error") return []
    return [...all].reverse().filter((c) => {
      const recs = recsOf(c)
      if (q && !c.text.toLowerCase().includes(q.toLowerCase())) return false
      if (mod && !recs.some((r) => r.target === mod)) return false
      switch (f) {
        case "needs":
          return c.status === "needs_input"
        case "failed":
          return c.status === "failed"
        case "undone":
          return recs.some((r) => r.state === "undone")
        case "voice":
        case "photo":
        case "quick_add":
        case "connector":
          return c.source === f
        default:
          return true
      }
    })
  }, [all, q, f, mod, state])

  const groups = useMemo(() => {
    const out: { day: string; items: Capture[] }[] = []
    for (const c of list) {
      const d = dayKey(new Date(c.at))
      const g = out.at(-1)
      if (g?.day === d) g.items.push(c)
      else out.push({ day: d, items: [c] })
    }
    return out
  }, [list])

  const stats = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86_400_000
    const week = all.filter((c) => new Date(c.at).getTime() > weekAgo)
    const recs = all.flatMap(recsOf)
    const saved = recs.filter((r) => r.log.some((l) => l.action === "saved"))
    const corrected = recs.filter(
      (r) => r.state === "undone" || r.state === "edited",
    )
    return {
      week: week.length,
      records: saved.length,
      correction: saved.length
        ? Math.round((corrected.length / saved.length) * 100)
        : 0,
    }
  }, [all])

  const today = dayKey()
  return (
    <Screen title="Capture history" back className={FOCUS}>
      {state === "error" ? (
        <Empty
          icon={<AlertTriangle className="size-8 text-bad" />}
          title="Couldn't load history"
          body="Your captures are safe on this device. Try again in a moment."
          action={<Btn href="/capture/history">Retry</Btn>}
        />
      ) : (
        <>
          <Card className="grid grid-cols-3 gap-2">
            <Stat label="Captures · 7d" value={stats.week} />
            <Stat label="Entries by AI" value={stats.records} />
            <Stat
              label="Corrected"
              value={`${stats.correction}%`}
              goodWhen="down"
            />
          </Card>
          <div className="relative mt-3">
            <Search className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search what you said"
              className="h-11 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-[15px] outline-none focus:border-primary"
            />
          </div>
          <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {FILTERS.map((x) => (
              <Chip
                key={x.v}
                active={f === x.v}
                onClick={() => setF(x.v)}
                className="h-11"
              >
                {x.label}
              </Chip>
            ))}
          </div>
          <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1">
            {(Object.keys(TARGET_META) as Target[]).map((t) => (
              <Chip
                key={t}
                accent={TARGET_META[t].accent}
                active={mod === t}
                onClick={() => setMod(mod === t ? null : t)}
                className="h-11"
              >
                {TARGET_META[t].label}
              </Chip>
            ))}
          </div>
          {groups.length === 0 ? (
            <Empty
              icon={<History className="size-8" />}
              title={
                all.length && state !== "empty"
                  ? "Nothing matches"
                  : "No captures yet"
              }
              body={
                all.length && state !== "empty"
                  ? "Try another filter or search."
                  : "Everything you type, say or snap shows up here with what it saved."
              }
              action={<Btn href="/capture">Start capturing</Btn>}
            />
          ) : (
            groups.map((g) => (
              <div key={g.day}>
                <SectionTitle>{dayLabel(g.day, today)}</SectionTitle>
                <div className="divide-y divide-border/40 rounded-2xl border border-border/60 bg-card px-3">
                  {g.items.map((c) => (
                    <CaptureRow key={c.id} cap={c} />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------- CAP-13

export function CaptureDetailScreen({ id }: { id: string }) {
  const router = useRouter()
  const cap = captureStore.use((s) => s.captures.find((c) => c.id === id))
  const [rerun, setRerun] = useState(false)
  const [text, setText] = useState<string | null>(null)
  const [quick, setQuick] = useState(false)
  if (!cap)
    return (
      <Screen title="Capture" back>
        <Empty
          title="Capture not found"
          body="It may have been deleted or the thread was cleared."
          action={<Btn href="/capture/history">History</Btn>}
        />
      </Screen>
    )
  const recs = recsOf(cap)
  return (
    <CaptureCtx.Provider
      value={{
        quickAdd: () => setQuick(true),
        send: (t) => sendCapture({ text: t }),
      }}
    >
      <Screen
        title="Capture"
        back
        className={FOCUS}
        actions={
          <button
            type="button"
            aria-label="Delete capture"
            onClick={() => {
              deleteCapture(cap.id)
              toast("Capture deleted — its entries stay where they were saved")
              router.push("/capture/history")
            }}
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <Trash2 className="size-5" />
          </button>
        }
      >
        <div className="mb-1 flex items-center gap-2 text-muted-foreground text-xs">
          {SOURCE_LABEL[cap.source]} ·{" "}
          {dayLabel(dayKey(new Date(cap.at)), dayKey())} {timeLabel(cap.at)}
          {cap.status === "needs_input" && (
            <span className="rounded-full bg-warn/15 px-2 py-0.5 font-semibold text-warn">
              Needs answer
            </span>
          )}
          {cap.status === "failed" && (
            <span className="rounded-full bg-bad/15 px-2 py-0.5 font-semibold text-bad">
              Failed
            </span>
          )}
        </div>
        <Card>
          {cap.photo && (
            // biome-ignore lint/performance/noImgElement: data-URL thumbnail
            <img
              src={cap.photo}
              alt="Captured"
              className="mb-3 max-h-60 w-full rounded-xl object-cover"
            />
          )}
          {cap.source === "photo" && !cap.photo && (
            <div className="mb-3 grid h-32 place-items-center rounded-xl bg-muted text-muted-foreground">
              <Camera className="size-6" />
            </div>
          )}
          {cap.source === "voice" && (
            <div className="mb-3 flex items-center gap-3 rounded-xl bg-muted/60 p-2.5">
              <span className="grid size-9 place-items-center rounded-full bg-primary text-primary-foreground">
                <Mic className="size-4" />
              </span>
              <div className="flex h-6 flex-1 items-center gap-[2px]">
                {Array.from({ length: 40 }, (_, i) => (
                  <span
                    key={i}
                    className="w-1 rounded-full bg-muted-foreground/40"
                    style={{ height: `${20 + ((i * 37) % 80)}%` }}
                  />
                ))}
              </div>
              <span className="num text-muted-foreground text-xs">
                {fmtDuration(cap.durationSec ?? 0)}
              </span>
            </div>
          )}
          <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            {cap.source === "voice"
              ? "Transcript"
              : cap.source === "photo"
                ? "Caption"
                : "You said"}
          </div>
          {text === null ? (
            <p className="mt-1 whitespace-pre-line text-[15px]">
              {cap.text || <span className="text-muted-foreground">—</span>}
            </p>
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-xl border border-border bg-background p-2 text-[15px] outline-none focus:border-primary"
            />
          )}
          <div className="mt-3 flex gap-2">
            {text === null ? (
              <>
                <Btn
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setText(cap.text)}
                >
                  Edit {cap.source === "voice" ? "transcript" : "text"}
                </Btn>
                <Btn
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setRerun(true)}
                >
                  <RefreshCw className="size-4" /> Re-run AI
                </Btn>
              </>
            ) : (
              <>
                <Btn variant="ghost" onClick={() => setText(null)}>
                  Cancel
                </Btn>
                <Btn className="flex-1" onClick={() => setRerun(true)}>
                  Save & re-run
                </Btn>
              </>
            )}
          </div>
          {cap.status === "failed" && (
            <Btn
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => retryCapture(cap.id)}
            >
              <RotateCw className="size-4" /> Retry
            </Btn>
          )}
        </Card>

        <SectionTitle>What it did</SectionTitle>
        {cap.status === "queued" ? (
          <Card className="text-muted-foreground text-sm">
            Queued on this device — it'll be processed when you're back online,
            using the time you captured it.
          </Card>
        ) : cap.reply ? (
          <div className="space-y-2">
            {cap.reply.items.map((it) => (
              <ReplyItemView key={it.id} it={it} captureId={cap.id} />
            ))}
          </div>
        ) : (
          <Card className="text-muted-foreground text-sm">Still thinking…</Card>
        )}

        {recs.length > 0 && (
          <>
            <SectionTitle>Write log</SectionTitle>
            <Card className="space-y-3">
              {recs.map((r) => (
                <div key={r.id}>
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <span
                      className={cn(
                        "size-2 rounded-full",
                        tint[TARGET_META[r.target].accent].solid,
                      )}
                    />
                    {TARGET_META[r.target].label} › {KIND_LABEL[r.kind]}
                    <span className="ml-auto text-muted-foreground text-xs">
                      {r.tier === "auto" ? "Auto-save" : "Confirm"}
                    </span>
                  </div>
                  <ol className="mt-1 ml-1 space-y-0.5 border-border border-l pl-3 text-muted-foreground text-xs">
                    {r.log.map((l, i) => (
                      <li key={i}>
                        <span className="text-foreground capitalize">
                          {l.action}
                        </span>{" "}
                        by {l.actor === "ai" ? "AI" : "you"} · {timeLabel(l.at)}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </Card>
          </>
        )}
      </Screen>

      <Dialog open={rerun} onOpenChange={setRerun}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Re-run the AI?</DialogTitle>
          <DialogDescription>
            Anything this capture saved is reverted, then the AI reads{" "}
            {text !== null ? "your edited text" : "it"} again and proposes fresh
            cards.
          </DialogDescription>
          <DialogFooter className="flex-row gap-2">
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => setRerun(false)}
            >
              Cancel
            </Btn>
            <Btn
              className="flex-1"
              onClick={() => {
                rerunCapture(cap.id, text ?? undefined)
                setText(null)
                setRerun(false)
              }}
            >
              Re-run
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <QuickAddSheet open={quick} onOpenChange={setQuick} />
    </CaptureCtx.Provider>
  )
}

// ---------------------------------------------------------------- CAP-14

export function QueueScreen() {
  const all = captureStore.use((s) => s.captures)
  const sim = captureStore.use((s) => s.settings.simulateOffline)
  const online = useOnline()
  const queued = useMemo(() => all.filter((c) => c.status === "queued"), [all])
  return (
    <Screen title="Pending" back className={FOCUS}>
      <Card
        className={cn("flex items-center gap-3", !online && "border-warn/40")}
      >
        <span
          className={cn(
            "grid size-10 place-items-center rounded-full",
            online ? "bg-good/15 text-good" : "bg-warn/15 text-warn",
          )}
        >
          <WifiOff className="size-5" />
        </span>
        <div className="flex-1">
          <div className="font-semibold">{online ? "Online" : "Offline"}</div>
          <div className="text-muted-foreground text-xs">
            {queued.length
              ? `${queued.length} capture${queued.length === 1 ? "" : "s"} waiting · they keep the time you captured them`
              : "Nothing waiting to sync"}
          </div>
        </div>
      </Card>
      <Card className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <div className="font-medium text-sm">Simulate offline</div>
          <div className="text-muted-foreground text-xs">
            Prototype switch — captures queue instead of processing.
          </div>
        </div>
        <Toggle
          label="Simulate offline"
          on={sim}
          onChange={(v) =>
            captureStore.set((s) => ({
              ...s,
              settings: { ...s.settings, simulateOffline: v },
            }))
          }
        />
      </Card>

      <SectionTitle
        action={
          queued.length > 0 && (
            <button
              type="button"
              disabled={!online}
              onClick={() => {
                const n = processQueue()
                toast(n ? `Processing ${n}…` : "Still offline")
              }}
              className="min-h-11 px-1 font-medium text-primary text-sm disabled:opacity-40"
            >
              Retry all
            </button>
          )
        }
      >
        Queue
      </SectionTitle>
      {queued.length === 0 ? (
        <Empty
          title="All caught up"
          body="Anything you capture without signal waits here, then processes in order."
          action={<Btn href="/capture">Open Capture</Btn>}
        />
      ) : (
        <div className="space-y-2">
          {queued.map((c) => (
            <Card key={c.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {c.text || c.fileName || "Photo"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {SOURCE_LABEL[c.source]} · captured {timeLabel(c.at)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Retry now"
                onClick={() => retryCapture(c.id)}
                className="grid size-11 place-items-center rounded-full bg-muted"
              >
                <RotateCw className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Delete queued capture"
                onClick={() => deleteCapture(c.id)}
                className="grid size-11 place-items-center rounded-full bg-muted text-bad"
              >
                <Trash2 className="size-4" />
              </button>
            </Card>
          ))}
        </div>
      )}
      <p className="mt-4 px-1 text-[11px] text-muted-foreground">
        <Link href="/capture" className="underline">
          Back to the thread
        </Link>
      </p>
    </Screen>
  )
}
