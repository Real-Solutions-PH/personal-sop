"use client"

import {
  Camera,
  Clock,
  FileText,
  Maximize2,
  MessageCircle,
  Mic,
  PenLine,
  Zap,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { captureUi, closeCapture } from "../lib/capture"
import { processQueue, sendCapture } from "./actions"
import { CaptureCtx, Exchange } from "./cards"
import { Composer } from "./composer"
import type { Capture, RecordCard } from "./data"
import { resumeStuck } from "./engine"
import { QuickAddSheet } from "./quickadd"
import { captureStore, useOnline } from "./store"
import { toast } from "./toast"
import {
  AiAvatar,
  FOCUS,
  NO_DEFAULT_CLOSE,
  SheetCloseButton,
  TARGET_META,
  timeLabel,
  tint,
} from "./ui"

export { addJournalEntry } from "./actions"
export { journalStreak } from "./screens/journal"

// The (+) Capture sheet over the current screen (IA §11): keeps context, shows
// this session's exchanges inline, and expands to the full thread at /capture.

export const EXAMPLES: Record<string, string[]> = {
  "": [
    "ran 5k 32 min, spent 250 on grab, remind me to pay rent on the 30th",
    "did my meditation",
    "how much did I spend on food this month?",
    "weighed 78.4",
  ],
  meal: ["2 eggs, pandesal and coffee", "adobo with 1 cup rice for lunch"],
  expense: [
    "180 lunch at jollibee gcash",
    "paid 1500",
    "moved 2k from GCash to BPI",
  ],
  task: [
    "remind me to pay rent on the 30th",
    "buy eggs, milk, rice",
    "done with the report",
  ],
  journal: ["long day but I showed up anyway"],
  "weigh-in": ["78.4"],
  workout: [
    "bench 60x5x3",
    "did legs: squat 3x5 100, rdl 3x8 80",
    "ran 5k in 32 min",
  ],
}

const SRC_ICON = {
  text: PenLine,
  voice: Mic,
  photo: Camera,
  file: FileText,
  quick_add: Zap,
  connector: Zap,
  chat: MessageCircle,
}

const HINT_ALIAS: Record<string, string> = {
  tasks: "task",
  todo: "task",
  reminder: "task",
  meals: "meal",
  food: "meal",
  weight: "weigh-in",
  weighin: "weigh-in",
  weigh: "weigh-in",
  workouts: "workout",
  gym: "workout",
  money: "expense",
  expenses: "expense",
  receipt: "expense",
}

/** Module hints → a chip; a free-text hint ("buy eggs, call Mark 3pm") pre-fills the composer. */
export function normHint(h?: string): { hint?: string; prefill?: string } {
  if (!h) return {}
  const k = h.toLowerCase().trim()
  if (/\s/.test(k) && k.length > 12) return { prefill: h }
  return { hint: HINT_ALIAS[k] ?? k }
}

/** Module dots for a capture's cards (history/recent rows). */
export function CardDots({ cap }: { cap: Capture }) {
  const recs = (cap.reply?.items ?? []).filter(
    (i): i is RecordCard => i.t === "record",
  )
  return (
    <span className="flex gap-0.5">
      {recs.map((r) => (
        <span
          key={r.id}
          className={cn(
            "size-2 rounded-full",
            r.state === "undone" || r.state === "discarded"
              ? "bg-muted"
              : tint[TARGET_META[r.target].accent].solid,
          )}
        />
      ))}
    </span>
  )
}

export function StatusPill({ cap }: { cap: Capture }) {
  const map: Partial<Record<Capture["status"], [string, string]>> = {
    needs_input: ["Needs answer", "bg-warn/15 text-warn"],
    queued: ["Queued", "bg-warn/15 text-warn"],
    failed: ["Failed", "bg-bad/15 text-bad"],
    processing: ["Thinking…", "bg-primary/15 text-primary"],
    answered: ["Answered", "bg-muted text-muted-foreground"],
  }
  const hit = map[cap.status]
  if (!hit) return null
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 font-semibold text-[10px]",
        hit[1],
      )}
    >
      {hit[0]}
    </span>
  )
}

export function CaptureRow({
  cap,
  onClick,
}: {
  cap: Capture
  onClick?: () => void
}) {
  const Icon = SRC_ICON[cap.source]
  return (
    <Link
      href={`/capture/history/${cap.id}`}
      onClick={onClick}
      className="flex min-h-14 items-center gap-3 rounded-xl px-1 py-2.5 active:bg-muted/60"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          {cap.text || cap.fileName || (cap.source === "photo" ? "Photo" : "—")}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          {timeLabel(cap.at)}
          <CardDots cap={cap} />
        </div>
      </div>
      <StatusPill cap={cap} />
    </Link>
  )
}

/** App-wide runtime: replay the offline queue on reconnect, resume stuck turns. */
function useCaptureRuntime() {
  const online = useOnline()
  const was = useRef(online)
  useEffect(() => {
    resumeStuck()
    // The open flag persists in localStorage; a reload shouldn't pop the sheet.
    closeCapture()
  }, [])
  useEffect(() => {
    if (online && !was.current) {
      const n = processQueue()
      if (n)
        toast.success(
          `Back online — processing ${n} queued capture${n === 1 ? "" : "s"}`,
        )
    }
    was.current = online
  }, [online])
}

export function CaptureSheet() {
  useCaptureRuntime()
  const router = useRouter()
  const open = captureUi.use((s) => s.open)
  const ctx = captureUi.use((s) => s.ctx)
  const captures = captureStore.use((s) => s.captures)
  const [session, setSession] = useState<string[]>([])
  const [hint, setHint] = useState<string | undefined>()
  const [prefill, setPrefill] = useState<string | undefined>()
  const [quick, setQuick] = useState(false)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      const h = normHint(ctx.hint)
      setSession([])
      setHint(h.hint)
      setPrefill(h.prefill)
    }
  }, [open, ctx])

  const mine = useMemo(
    () => captures.filter((c) => session.includes(c.id)),
    [captures, session],
  )
  const recent = useMemo(() => [...captures].reverse().slice(0, 5), [captures])
  const waiting = useMemo(
    () => captures.filter((c) => c.status === "needs_input").length,
    [captures],
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [mine])

  const go = (href: string) => {
    closeCapture()
    router.push(href)
  }

  return (
    <CaptureCtx.Provider
      value={{
        quickAdd: () => setQuick(true),
        send: (t) => setSession((s) => [...s, sendCapture({ text: t })]),
        close: closeCapture,
      }}
    >
      <Sheet open={open} onOpenChange={(v) => !v && closeCapture()}>
        <SheetContent
          side="bottom"
          className={cn(
            "mx-auto flex max-h-[88dvh] max-w-md flex-col gap-0 rounded-t-3xl border-border/60 p-0",
            FOCUS,
            NO_DEFAULT_CLOSE,
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
          <SheetCloseButton className="top-3" />
          <div className="flex items-center gap-1.5 px-4 pt-1 pr-14 pb-2">
            <AiAvatar className="size-8" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-display text-xl leading-tight">
                Capture
              </SheetTitle>
              <SheetDescription className="text-xs">
                Log or ask anything — type, talk or snap
              </SheetDescription>
            </div>
            <button
              type="button"
              aria-label="Capture history"
              onClick={() => go("/capture/history")}
              className="relative grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <Clock className="size-[18px]" />
              {waiting > 0 && (
                <span className="absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-warn font-bold text-[9px] text-black">
                  {waiting}
                </span>
              )}
            </button>
            <button
              type="button"
              aria-label="Open full thread"
              onClick={() => go(hint ? `/capture?hint=${hint}` : "/capture")}
              className="grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <Maximize2 className="size-[18px]" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
            {mine.length ? (
              <div className="space-y-5 pt-2">
                {mine.map((c) => (
                  <Exchange key={c.id} cap={c} compact />
                ))}
                <div ref={end} />
              </div>
            ) : (
              <>
                <div className="mt-1 mb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                  Try
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(EXAMPLES[hint ?? ""] ?? EXAMPLES[""]).map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => setPrefill(e)}
                      className="min-h-11 rounded-2xl bg-muted/70 px-3.5 py-2 text-left text-sm active:bg-muted"
                    >
                      {e}
                    </button>
                  ))}
                </div>
                {recent.length > 0 && (
                  <>
                    <div className="mt-4 mb-0.5 flex items-center justify-between">
                      <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
                        Recent
                      </span>
                      <button
                        type="button"
                        onClick={() => go("/capture")}
                        className="min-h-11 px-1 font-medium text-primary text-sm"
                      >
                        Full thread
                      </button>
                    </div>
                    <div className="divide-y divide-border/40">
                      {recent.map((c) => (
                        <CaptureRow key={c.id} cap={c} onClick={closeCapture} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          <div className="pb-safe shrink-0">
            <Composer
              hint={hint}
              onHint={setHint}
              mode={open ? ctx.mode : undefined}
              prefill={prefill}
              autoFocus={open && !ctx.mode}
              onSent={(id) => setSession((s) => [...s, id])}
              onQuickAdd={() => setQuick(true)}
              onNavigate={closeCapture}
            />
          </div>
        </SheetContent>
      </Sheet>
      <QuickAddSheet open={quick} onOpenChange={setQuick} />
    </CaptureCtx.Provider>
  )
}
