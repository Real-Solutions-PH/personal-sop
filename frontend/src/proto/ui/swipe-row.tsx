"use client"

import { Check } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { blocked, passed, useSwipe } from "@/hooks/useSwipe"
import { cn } from "@/lib/utils"

const TRAY_BTN =
  "flex w-18 flex-col items-center justify-center gap-0.5 font-medium text-[11px]"

/** A button for SwipeRow's tray. */
export function SwipeAction({
  onClick,
  icon,
  label,
  className,
}: {
  onClick: () => void
  icon: ReactNode
  label: string
  className?: string
}) {
  return (
    <button type="button" onClick={onClick} className={cn(TRAY_BTN, className)}>
      {icon}
      {label}
    </button>
  )
}

/**
 * Swipe right past 80px to run onDone; swipe left to reveal the actions tray.
 * Touch only: every action here must also be reachable from a button (the row's
 * ⋯ menu or its detail page) for mouse, keyboard and screen-reader users.
 */
export function SwipeRow({
  children,
  onDone,
  doneLabel = "Done",
  doneClass = "bg-good text-background",
  actions,
}: {
  children: ReactNode
  onDone?: () => void
  doneLabel?: string
  doneClass?: string
  /** SwipeAction buttons, revealed by a left swipe. */
  actions?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const tray = useRef<HTMLDivElement>(null)
  const w = () => tray.current?.offsetWidth ?? 0
  const base = open ? -w() : 0
  const off = drag ?? base

  const swipe = useSwipe({
    claim: ({ axis, dx, target }) =>
      axis === "x" &&
      !!root.current &&
      !blocked(target, root.current, "x") &&
      (dx > 0 ? !!onDone || open : !!actions && !open),
    move: (dx) =>
      setDrag(Math.min(onDone ? 140 : 0, Math.max(-w(), base + dx))),
    end: (dx, _, v) => {
      const x = base + dx
      setDrag(null)
      if (x > 0) {
        setOpen(false)
        if (!open && onDone && passed(x, v, 80)) onDone()
      } else setOpen(v > 0.5 ? false : v < -0.5 || x < -w() / 2)
    },
  })

  // Any touch outside the row closes it — one open row at a time.
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [open])

  return (
    <div ref={root} className="relative overflow-hidden">
      {onDone && off > 0 && (
        <div
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap pl-4 font-medium text-sm",
            doneClass,
          )}
          style={{ width: off, opacity: Math.min(1, off / 80) }}
        >
          <Check className="size-4 shrink-0" strokeWidth={3} />
          {doneLabel}
        </div>
      )}
      <div
        ref={swipe}
        // While open, a tap on the row closes it instead of opening the item.
        onClickCapture={(e) => {
          if (!open) return
          e.stopPropagation()
          e.preventDefault()
          setOpen(false)
        }}
        className={cn(drag === null && "transition-transform duration-200")}
        style={off ? { transform: `translateX(${off}px)` } : undefined}
      >
        {children}
      </div>
      {actions && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: bubbling from the tray's own buttons, which handle keys
        // biome-ignore lint/a11y/noStaticElementInteractions: same
        <div
          ref={tray}
          inert={!open && drag === null}
          onClick={() => setOpen(false)}
          className={cn(
            "absolute inset-y-0 right-0 flex",
            drag === null && "transition-transform duration-200",
          )}
          style={{ transform: `translateX(calc(100% + ${off}px))` }}
        >
          {actions}
        </div>
      )}
    </div>
  )
}
