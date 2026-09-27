"use client"

import {
  Camera,
  ChevronLeft,
  Clock,
  Settings2,
  ShieldCheck,
  WifiOff,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { CaptureMode } from "../../lib/capture"
import { dayKey } from "../../lib/day"
import { liveStore } from "../../lib/live"
import { sendCapture } from "../actions"
import { CaptureCtx, Exchange } from "../cards"
import { Composer } from "../composer"
import type { Capture } from "../data"
import { EXAMPLES, normHint } from "../index"
import { QuickAddSheet } from "../quickadd"
import { captureStore, useOnline } from "../store"
import { AiAvatar, dayLabel, FOCUS } from "../ui"

// CAP-01 Capture thread (full screen), CAP-01E empty state, CAP-19 error demo.

function demoCapture(kind: "error" | "loading"): Capture {
  return {
    id: `demo-${kind}`,
    at: new Date().toISOString(),
    source: "voice",
    durationSec: 12,
    text: kind === "error" ? "" : "spent 320 on grabfood and did my meditation",
    status: kind === "error" ? "failed" : "processing",
    clientUuid: "demo",
    reply:
      kind === "error"
        ? {
            text: "I kept your voice note.",
            items: [
              {
                t: "info",
                id: "demo-err",
                tone: "error",
                title: "Transcription failed",
                body: "The audio was too noisy to read. Your recording is saved — retry, type what you said, or add it by hand.",
                actions: [
                  { label: "Retry", do: "retry" },
                  {
                    label: "Type it instead",
                    do: "prompt",
                    prompt: "spent 320 on grabfood",
                  },
                  { label: "Quick add", do: "quickadd" },
                ],
              },
            ],
          }
        : undefined,
  }
}

export function ThreadScreen() {
  const router = useRouter()
  const sp = useSearchParams()
  const state = sp.get("state")
  const captures = captureStore.use((s) => s.captures)
  const live = liveStore.use((s) => s.live)
  const online = useOnline()
  const [hint, setHint] = useState<string | undefined>(
    normHint(sp.get("hint") ?? undefined).hint,
  )
  const [prefill, setPrefill] = useState<string | undefined>(
    sp.get("q") ?? undefined,
  )
  const [quick, setQuick] = useState(false)
  const [mode, setMode] = useState<CaptureMode | undefined>()
  const end = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    if (state === "empty") return []
    const list = [...captures]
    if (state === "error" || state === "loading") list.push(demoCapture(state))
    return list
  }, [captures, state])

  const groups = useMemo(() => {
    const out: { day: string; items: Capture[] }[] = []
    for (const c of shown) {
      const d = dayKey(new Date(c.at))
      const g = out.at(-1)
      if (g?.day === d) g.items.push(c)
      else out.push({ day: d, items: [c] })
    }
    return out
  }, [shown])

  const waiting = captures.filter((c) => c.status === "needs_input").length
  const queued = captures.filter((c) => c.status === "queued").length
  const today = dayKey()

  // biome-ignore lint/correctness/useExhaustiveDependencies: keep pinned to the latest message
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [shown])

  const bottomPad = (live ? 56 : 0) + (online ? 0 : 44)

  return (
    <CaptureCtx.Provider
      value={{
        quickAdd: () => setQuick(true),
        send: (t) => sendCapture({ text: t }),
      }}
    >
      <div className={cn("flex h-full flex-col", FOCUS)}>
        <header className="pt-safe sticky top-0 z-20 shrink-0 border-border/40 border-b bg-background/90 backdrop-blur-md">
          <div className="flex h-14 items-center gap-1.5 px-2">
            <button
              type="button"
              aria-label="Back"
              onClick={() => router.push("/today")}
              className="grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <ChevronLeft className="size-5" />
            </button>
            <AiAvatar className="size-8" />
            <div className="min-w-0 flex-1 pl-1">
              <h1 className="font-display font-semibold text-xl leading-tight">
                Capture
              </h1>
              <p className="text-muted-foreground text-xs">
                Log or ask anything
              </p>
            </div>
            {(!online || queued > 0) && (
              <Link
                href="/capture/queue"
                aria-label={`${queued} queued — open pending`}
                className="flex h-11 items-center gap-1 rounded-full bg-warn/15 px-3 font-semibold text-sm text-warn"
              >
                <WifiOff className="size-3.5" /> {queued}
              </Link>
            )}
            <Link
              href="/capture/history"
              aria-label="History"
              className="relative grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <Clock className="size-5" />
              {waiting > 0 && (
                <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-warn font-bold text-[9px] text-black">
                  {waiting}
                </span>
              )}
            </Link>
            <Link
              href="/capture/settings"
              aria-label="AI settings"
              className="grid size-11 place-items-center rounded-full hover:bg-muted"
            >
              <Settings2 className="size-5" />
            </Link>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
          {groups.length === 0 ? (
            <div className="flex min-h-full flex-col items-center justify-center py-10 text-center">
              <AiAvatar className="size-14 [&>svg]:size-6" />
              <h2 className="mt-4 font-display font-semibold text-3xl tracking-tight">
                What happened today?
              </h2>
              <p className="mt-1 max-w-72 text-muted-foreground text-sm">
                Say it the way you'd text a friend. Several things at once is
                fine — I'll sort them into the right places.
              </p>
              <div className="mt-5 w-full space-y-2">
                {[...EXAMPLES[""], "Snap your lunch"].map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      if (e !== "Snap your lunch") return setPrefill(e)
                      setHint("meal")
                      setMode("photo")
                      setTimeout(() => setMode(undefined), 400)
                    }}
                    className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-border/60 bg-card px-4 py-3 text-left text-sm active:bg-muted"
                  >
                    {e === "Snap your lunch" && (
                      <Camera className="size-4 text-primary" aria-hidden />
                    )}
                    {e}
                  </button>
                ))}
              </div>
              <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5" /> Only what a message needs
                is sent to the AI. Your journal stays out of Q&A.
              </p>
            </div>
          ) : (
            <div className="space-y-6 py-4">
              {groups.map((g) => (
                <div key={g.day} className="space-y-5">
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="h-px flex-1 bg-border/60" />
                    {dayLabel(g.day, today)}
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                  {g.items.map((c) => (
                    <Exchange key={c.id} cap={c} />
                  ))}
                </div>
              ))}
              <div ref={end} />
            </div>
          )}
        </div>

        <div className="shrink-0" style={{ paddingBottom: bottomPad }}>
          <Composer
            hint={hint}
            onHint={setHint}
            prefill={prefill}
            mode={mode}
            autoFocus
            onQuickAdd={() => setQuick(true)}
          />
        </div>
      </div>
      <QuickAddSheet open={quick} onOpenChange={setQuick} />
    </CaptureCtx.Provider>
  )
}
