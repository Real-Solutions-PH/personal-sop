"use client"

import {
  ArrowUp,
  BookOpen,
  Camera,
  CheckSquare,
  Dumbbell,
  Mic,
  Paperclip,
  Plus,
  Scale,
  Utensils,
  Wallet,
  WifiOff,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { CaptureMode } from "../lib/capture"
import { sendCapture } from "./actions"
import { FileSheet, PhotoSheet } from "./photo"
import { useOnline } from "./store"
import { VoiceSheet } from "./voice"

// The composer (CAP-01): text + 🎤 + 📷 + 📎 + quick add, with context hint chips.

export const HINT_CHIPS: { v: string; label: string; icon: typeof Wallet }[] = [
  { v: "meal", label: "Meal", icon: Utensils },
  { v: "expense", label: "Expense", icon: Wallet },
  { v: "task", label: "Task", icon: CheckSquare },
  { v: "journal", label: "Journal", icon: BookOpen },
  { v: "weigh-in", label: "Weigh-in", icon: Scale },
  { v: "workout", label: "Workout", icon: Dumbbell },
]

const PLACEHOLDER: Record<string, string> = {
  meal: "What did you eat? e.g. adobo, 1 cup rice",
  expense: "e.g. 180 lunch gcash",
  task: "e.g. call the dentist fri 10am",
  journal: "Write it out, or tap 🎤 and talk…",
  "weigh-in": "e.g. 78.4",
  workout: "e.g. bench 60x5x3 · ran 5k 30 min",
}

export function Composer({
  hint,
  onHint,
  mode,
  prefill,
  autoFocus,
  onSent,
  onQuickAdd,
  onNavigate,
  showHints = true,
}: {
  hint?: string
  onHint: (h: string | undefined) => void
  /** Open straight into voice / photo / file (from openCapture({ mode })). */
  mode?: CaptureMode
  prefill?: string
  autoFocus?: boolean
  onSent?: (id: string) => void
  onQuickAdd: () => void
  onNavigate?: () => void
  showHints?: boolean
}) {
  const router = useRouter()
  const online = useOnline()
  const [text, setText] = useState(prefill ?? "")
  const [voice, setVoice] = useState(false)
  const [photo, setPhoto] = useState(false)
  const [file, setFile] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (prefill !== undefined) setText(prefill)
  }, [prefill])

  useEffect(() => {
    if (mode === "voice") setVoice(true)
    else if (mode === "photo") setPhoto(true)
    else if (mode === "file") setFile(true)
    else if (autoFocus) setTimeout(() => ta.current?.focus(), 150)
  }, [mode, autoFocus])

  // autosize
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize on text change
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [text])

  const send = () => {
    const t = text.trim()
    if (!t) return
    const id = sendCapture({ text: t, source: "text", hint })
    setText("")
    onSent?.(id)
    ta.current?.focus()
  }

  return (
    <div className="border-border/60 border-t bg-background/95 px-3 pt-2 pb-3 backdrop-blur">
      {showHints && (
        <div className="-mx-3 mb-2 flex gap-1.5 overflow-x-auto px-3 [scrollbar-width:none]">
          {HINT_CHIPS.map((h) => (
            <button
              key={h.v}
              type="button"
              onClick={() => onHint(hint === h.v ? undefined : h.v)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 font-medium text-sm transition-colors duration-150",
                hint === h.v
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              <h.icon className="size-4" aria-hidden />
              {h.label}
            </button>
          ))}
        </div>
      )}
      {!online && (
        <div className="mb-2 flex items-center gap-1.5 text-warn text-xs">
          <WifiOff className="size-3.5" /> Offline — I'll queue it and process
          when you're back.
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button
          type="button"
          aria-label="Quick add"
          onClick={onQuickAdd}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground active:scale-95"
        >
          <Plus className="size-5" />
        </button>
        <div className="flex min-h-11 flex-1 items-end rounded-3xl border border-border bg-card pr-1 pl-3.5 focus-within:border-primary/60">
          <textarea
            ref={ta}
            rows={1}
            value={text}
            aria-label="Capture message"
            placeholder={PLACEHOLDER[hint ?? ""] ?? "Log or ask anything…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                send()
              }
            }}
            className="max-h-36 min-h-11 flex-1 resize-none bg-transparent py-3 text-[15px] leading-5 outline-none placeholder:text-muted-foreground/70"
          />
          {!text && (
            <>
              <button
                type="button"
                aria-label="Attach statement file"
                onClick={() => setFile(true)}
                className="grid size-11 place-items-center rounded-full text-muted-foreground active:bg-muted"
              >
                <Paperclip className="size-[18px]" />
              </button>
              <button
                type="button"
                aria-label="Photo"
                onClick={() => setPhoto(true)}
                className="grid size-11 place-items-center rounded-full text-muted-foreground active:bg-muted"
              >
                <Camera className="size-[18px]" />
              </button>
            </>
          )}
        </div>
        {text.trim() ? (
          <button
            type="button"
            aria-label="Send"
            onClick={send}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 active:scale-95"
          >
            <ArrowUp className="size-5" strokeWidth={2.5} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Record voice"
            onClick={() => setVoice(true)}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-hab text-white shadow-md shadow-primary/30 active:scale-95"
          >
            <Mic className="size-5" />
          </button>
        )}
      </div>

      <VoiceSheet
        open={voice}
        onOpenChange={setVoice}
        hint={hint}
        maxSec={hint === "journal" ? 600 : 300}
        onDone={(t, sec) => {
          const id = sendCapture({
            text: t,
            source: "voice",
            hint,
            durationSec: sec,
          })
          onSent?.(id)
        }}
      />
      <PhotoSheet
        open={photo}
        onOpenChange={setPhoto}
        hint={hint}
        onSend={({ photo: p, hint: h, caption }) => {
          const id = sendCapture({
            text: caption,
            source: "photo",
            hint: h,
            photo: p,
          })
          onSent?.(id)
        }}
      />
      <FileSheet
        open={file}
        onOpenChange={setFile}
        onSend={({ fileName, account }) => {
          sendCapture({
            text: "Statement",
            source: "file",
            fileName,
            hint: account,
          })
          onNavigate?.()
          router.push(`/finance/import?account=${account}`)
        }}
      />
    </div>
  )
}
