"use client"

import {
  BarChart3,
  CalendarCheck2,
  Home,
  Pause,
  Plus,
  User,
  WifiOff,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { type ReactNode, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { CaptureSheet } from "../capture"
import "../wiring"
import { openCapture } from "../lib/capture"
import { fmtDuration } from "../lib/day"
import { elapsedSec, liveStore } from "../lib/live"

const tabs = [
  { href: "/today", label: "Today", icon: Home },
  { href: "/plan", label: "Plan", icon: CalendarCheck2 },
  null, // capture
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/me", label: "Me", icon: User },
] as const

function LiveBar() {
  const live = liveStore.use((s) => s.live)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [live])
  if (!live) return null
  return (
    <Link
      href={live.href}
      className="mx-3 mb-2 flex items-center gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-lg"
    >
      <span className="relative flex size-2.5">
        {!live.pausedAt && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/70" />
        )}
        <span className="relative inline-flex size-2.5 rounded-full bg-white" />
      </span>
      <span className="flex-1 truncate font-medium text-sm">{live.label}</span>
      {live.pausedAt && <Pause className="size-4" />}
      <span className="num font-semibold">{fmtDuration(elapsedSec(live))}</span>
    </Link>
  )
}

function OfflineBanner() {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    setOnline(navigator.onLine)
    window.addEventListener("online", on)
    window.addEventListener("offline", off)
    return () => {
      window.removeEventListener("online", on)
      window.removeEventListener("offline", off)
    }
  }, [])
  if (online) return null
  return (
    <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-warn/15 px-3 py-2 text-warn text-xs">
      <WifiOff className="size-4" />
      Offline — captures are queued and will sync.
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname()
  // ponytail: client-only render. Stores hydrate from localStorage, which the
  // server can't see, so SSR would always mismatch. Revisit when data comes from the API.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return (
    // Phone-width column; on desktop it renders as a centred device frame.
    <div className="min-h-dvh bg-background md:bg-muted/30 md:py-6">
      <div className="relative mx-auto flex h-dvh max-w-md flex-col overflow-hidden bg-background md:h-[min(860px,calc(100dvh_-_3rem))] md:rounded-[2.5rem] md:border md:shadow-2xl">
        <main className="flex-1 overflow-y-auto overscroll-contain">
          {mounted && children}
        </main>
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(4rem_+_env(safe-area-inset-bottom))] [&>*]:pointer-events-auto">
          <OfflineBanner />
          <LiveBar />
        </div>
        <nav className="pb-safe border-border/60 border-t bg-background/90 backdrop-blur-md">
          <div className="grid h-16 grid-cols-5 items-center">
            {tabs.map((t) =>
              t ? (
                <Link
                  key={t.href}
                  href={t.href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 text-[11px]",
                    path.startsWith(t.href)
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  <t.icon
                    className="size-5"
                    strokeWidth={path.startsWith(t.href) ? 2.4 : 1.8}
                  />
                  {t.label}
                </Link>
              ) : (
                <div key="capture" className="grid place-items-center">
                  <button
                    type="button"
                    aria-label="Capture — tap to type, hold to talk"
                    onClick={() => openCapture()}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      openCapture({ mode: "voice" })
                    }}
                    className="grid size-14 -translate-y-3 place-items-center rounded-full bg-gradient-to-br from-primary to-hab text-white shadow-lg shadow-primary/30 active:scale-95"
                  >
                    <Plus className="size-7" strokeWidth={2.5} />
                  </button>
                </div>
              ),
            )}
          </div>
        </nav>
        <CaptureSheet />
      </div>
    </div>
  )
}
