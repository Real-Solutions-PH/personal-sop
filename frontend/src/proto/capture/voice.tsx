"use client"

import {
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Send,
  Trash2,
  Wand2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { fmtDuration } from "../lib/day"
import { BottomSheet } from "./ui"

// CAP-02 Voice recorder (real getUserMedia + MediaRecorder, live waveform) and
// CAP-20 permission recovery. Transcription is simulated (OQ-CAP-5: server-side
// in v1) — a sample phrase is picked by the capture hint.

const SAMPLES: Record<string, string[]> = {
  general: [
    "ran 5k in 32 minutes, spent 250 on grab, remind me to pay rent on the 30th",
    "did my meditation and read 15 pages",
    "lunch was tapsilog, paid 160 cash",
    "bench 60x5x3, weighed 78.4 this morning",
    "gastos 45 sa jeep, buy eggs, milk, rice",
  ],
  journal: [
    "Today was long but good. Shipped the report before lunch and I actually took a proper break. Um, slept at 1am again last night though, I really need to fix that. Grateful for a quiet evening with the family.",
    "Honestly a meh day. Work was mostly meetings and I felt scattered. But I still went to the gym and that's the version of me I want to keep showing up as.",
  ],
  meal: [
    "two eggs, pandesal and coffee for breakfast",
    "chicken adobo with rice for lunch",
  ],
  expense: ["spent 180 on lunch at jollibee gcash", "paid 1500"],
  "weigh-in": ["weighed 78.4"],
  task: ["remind me to call the dentist tomorrow at 10am, buy detergent"],
  workout: ["did legs: squat 3x5 100, rdl 3x8 80"],
}
let pick = 0

export function sampleTranscript(hint?: string): string {
  const list = SAMPLES[hint ?? ""] ?? SAMPLES.general
  return list[pick++ % list.length]
}

type Phase =
  | "requesting"
  | "recording"
  | "paused"
  | "transcribing"
  | "denied"
  | "unsupported"
  | "simulating"

const BARS = 36

export function VoiceSheet({
  open,
  onOpenChange,
  hint,
  onDone,
  maxSec = 300,
  title = "Listening…",
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  hint?: string
  onDone: (transcript: string, durationSec: number) => void
  maxSec?: number
  title?: string
}) {
  const [phase, setPhase] = useState<Phase>("requesting")
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.05))
  const [sec, setSec] = useState(0)
  const alive = useRef(false)
  const r = useRef<{
    stream?: MediaStream
    rec?: MediaRecorder
    ctx?: AudioContext
    raf?: number
    tick?: ReturnType<typeof setInterval>
    started: number
    pausedAt?: number
    pausedMs: number
    last: number
  }>({ started: 0, pausedMs: 0, last: 0 })

  const cleanup = useCallback(() => {
    const x = r.current
    if (x.raf) cancelAnimationFrame(x.raf)
    if (x.tick) clearInterval(x.tick)
    try {
      if (x.rec && x.rec.state !== "inactive") x.rec.stop()
    } catch {}
    for (const t of x.stream?.getTracks() ?? []) t.stop()
    x.ctx?.close().catch(() => {})
    r.current = { started: 0, pausedMs: 0, last: 0 }
  }, [])

  const finish = useCallback(
    (duration: number) => {
      cleanup()
      setPhase("transcribing")
      setTimeout(
        () => {
          if (!alive.current) return
          onDone(sampleTranscript(hint), Math.max(1, Math.round(duration)))
          onOpenChange(false)
        },
        700 + Math.min(1200, duration * 40),
      )
    },
    [cleanup, hint, onDone, onOpenChange],
  )

  const elapsed = useCallback(() => {
    const x = r.current
    const now = x.pausedAt ?? Date.now()
    return (now - x.started - x.pausedMs) / 1000
  }, [])

  const start = useCallback(async () => {
    setPhase("requesting")
    setSec(0)
    setLevels(Array(BARS).fill(0.05))
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setPhase("unsupported")
      return
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      const name = (e as DOMException)?.name
      setPhase(
        name === "NotAllowedError" || name === "SecurityError"
          ? "denied"
          : "unsupported",
      )
      return
    }
    const rec = new MediaRecorder(stream)
    rec.start()
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.fftSize)
    r.current = { stream, rec, ctx, started: Date.now(), pausedMs: 0, last: 0 }
    const loop = () => {
      const x = r.current
      if (!x.ctx) return
      const now = performance.now()
      if (!x.pausedAt && now - x.last > 70) {
        x.last = now
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += ((v - 128) / 128) ** 2
        const rms = Math.sqrt(sum / buf.length)
        setLevels((l) => [...l.slice(1), Math.min(1, 0.06 + rms * 4)])
      }
      x.raf = requestAnimationFrame(loop)
    }
    r.current.raf = requestAnimationFrame(loop)
    r.current.tick = setInterval(() => {
      const s = elapsed()
      setSec(s)
      if (s >= maxSec) finish(s)
    }, 250)
    setPhase("recording")
  }, [finish, maxSec, elapsed])

  const simulate = () => {
    cleanup()
    setPhase("simulating")
    setSec(0)
    const t0 = Date.now()
    const id = setInterval(() => {
      const s = (Date.now() - t0) / 1000
      setSec(s)
      setLevels((l) => [...l.slice(1), 0.15 + Math.random() * 0.75])
      if (s > 2.6) {
        clearInterval(id)
        finish(hint === "journal" ? 24 : 6)
      }
    }, 80)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: start/stop on open only
  useEffect(() => {
    alive.current = open
    if (open) start()
    else cleanup()
    return cleanup
  }, [open])

  const togglePause = () => {
    const x = r.current
    if (!x.rec) return
    if (x.pausedAt) {
      x.pausedMs += Date.now() - x.pausedAt
      x.pausedAt = undefined
      x.rec.resume()
      setPhase("recording")
    } else {
      x.pausedAt = Date.now()
      x.rec.pause()
      setPhase("paused")
    }
  }

  const blocked = phase === "denied" || phase === "unsupported"
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={
        blocked
          ? "Microphone unavailable"
          : phase === "transcribing"
            ? "Transcribing…"
            : title
      }
      description={
        blocked
          ? undefined
          : phase === "transcribing"
            ? "Turning your voice note into text"
            : `Talk naturally — several things at once is fine. Max ${Math.round(maxSec / 60)} min.`
      }
    >
      {blocked ? (
        <div className="pb-2">
          <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-bad/12 text-bad">
            <MicOff className="size-6" />
          </div>
          <p className="text-center text-sm">
            {phase === "denied"
              ? "Microphone access is blocked for this app. Voice capture needs it to record — nothing is recorded until you tap the mic."
              : "This browser can't record audio here."}
          </p>
          <div className="mt-4 space-y-2 rounded-xl bg-muted/60 p-3 text-sm">
            <div>
              <b>iPhone (installed app):</b> Settings › Safari › Microphone ›
              Allow, then reopen the app.
            </div>
            <div>
              <b>Android Chrome:</b> tap the lock icon › Permissions ›
              Microphone › Allow.
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={start}
              className="h-11 rounded-xl bg-primary font-semibold text-primary-foreground text-sm"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={simulate}
              className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-muted font-medium text-sm"
            >
              <Wand2 className="size-4" /> Simulate a voice note (prototype)
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-11 rounded-xl font-medium text-muted-foreground text-sm"
            >
              Use text instead
            </button>
          </div>
        </div>
      ) : phase === "transcribing" ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="size-8 text-primary motion-safe:animate-spin" />
          <div className="text-muted-foreground text-sm">
            {fmtDuration(sec)} of audio
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center pb-2">
          <div className="num mb-4 font-display font-semibold text-5xl tabular-nums tracking-tight">
            {fmtDuration(sec)}
          </div>
          <div
            className="flex h-20 w-full items-center justify-center gap-[3px]"
            aria-hidden
          >
            {levels.map((v, i) => (
              <span
                key={i}
                className={cn(
                  "w-1.5 rounded-full transition-[height] duration-150",
                  phase === "paused"
                    ? "bg-muted-foreground/40"
                    : "bg-gradient-to-t from-primary to-hab",
                )}
                style={{ height: `${Math.max(6, v * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-2 h-5 text-muted-foreground text-xs">
            {phase === "requesting" && "Asking for the microphone…"}
            {phase === "paused" && "Paused"}
            {phase === "simulating" && "Simulated recording"}
            {phase === "recording" &&
              sec > maxSec - 30 &&
              `Stops at ${fmtDuration(maxSec)}`}
          </div>
          <div className="mt-4 flex w-full items-center justify-between px-4">
            <button
              type="button"
              aria-label="Cancel recording"
              onClick={() => onOpenChange(false)}
              className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground"
            >
              <Trash2 className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Stop and send"
              disabled={phase === "requesting"}
              onClick={() => finish(elapsed())}
              className="relative grid size-20 place-items-center rounded-full bg-gradient-to-br from-primary to-hab text-white shadow-lg shadow-primary/30 active:scale-95 disabled:opacity-50"
            >
              {phase === "recording" && (
                <span className="absolute inset-0 rounded-full bg-primary/30 motion-safe:animate-ping" />
              )}
              <Send className="relative size-7" />
            </button>
            <button
              type="button"
              aria-label={phase === "paused" ? "Resume" : "Pause"}
              onClick={togglePause}
              disabled={phase !== "recording" && phase !== "paused"}
              className="grid size-14 place-items-center rounded-full bg-muted disabled:opacity-40"
            >
              {phase === "paused" ? (
                <Play className="size-5" />
              ) : (
                <Pause className="size-5" />
              )}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Mic className="size-3" /> Audio is deleted after transcription (30
            days max).
          </div>
        </div>
      )}
    </BottomSheet>
  )
}
