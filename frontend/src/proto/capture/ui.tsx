"use client"

import {
  Annoyed,
  BookOpen,
  Briefcase,
  CheckSquare,
  Compass,
  Dumbbell,
  Frown,
  HeartPulse,
  Laugh,
  Meh,
  Repeat,
  Smile,
  Sparkles,
  Sprout,
  Users,
  Wallet,
  X,
} from "lucide-react"
import type { ReactNode } from "react"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { type Accent, Switch } from "../ui/kit"
import type { CaptureSource, RecordKind, Target } from "./data"

// Capture-local UI bits: module meta, the in-app bottom sheet, the AI avatar.

/** Visible focus ring for every button/link inside a container (design system). */
export const FOCUS =
  "[&_button:focus-visible]:outline-none [&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring [&_a:focus-visible]:outline-none [&_a:focus-visible]:ring-2 [&_a:focus-visible]:ring-ring"

/** Hides the tiny default sheet ✕ — we render a 44px one instead. */
export const NO_DEFAULT_CLOSE = "[&>button.rounded-xs]:hidden"

export const MOOD_ICON = {
  1: Frown,
  2: Annoyed,
  3: Meh,
  4: Smile,
  5: Laugh,
} as const

export const AREA_ICON: Record<string, typeof Wallet> = {
  identity: Compass,
  career: Briefcase,
  health: HeartPulse,
  money: Wallet,
  relationships: Users,
  growth: Sprout,
}

export function SheetCloseButton({ className }: { className?: string }) {
  return (
    <SheetClose
      aria-label="Close"
      className={cn(
        "absolute top-2 right-2 grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <X className="size-5" />
    </SheetClose>
  )
}

export const TARGET_META: Record<
  Target,
  { label: string; accent: Accent; icon: typeof Wallet; href: string }
> = {
  habits: { label: "Habits", accent: "hab", icon: Repeat, href: "/habits" },
  tasks: { label: "Tasks", accent: "tsk", icon: CheckSquare, href: "/tasks" },
  fitness: {
    label: "Fitness",
    accent: "fit",
    icon: Dumbbell,
    href: "/fitness",
  },
  finance: { label: "Finance", accent: "fin", icon: Wallet, href: "/finance" },
  journal: {
    label: "Journal",
    accent: "life",
    icon: BookOpen,
    href: "/journal",
  },
}

export const KIND_LABEL: Record<RecordKind, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  planned: "Bill / recurring",
  task: "Task",
  taskComplete: "Complete task",
  habitLog: "Check-in",
  habitCreate: "New habit",
  routineStart: "Routine",
  workout: "Workout",
  weighIn: "Weigh-in",
  meal: "Meal",
  journal: "Entry",
  photo: "Photo",
  command: "Change",
}

export const SOURCE_LABEL: Record<CaptureSource, string> = {
  text: "Text",
  voice: "Voice",
  photo: "Photo",
  file: "File",
  quick_add: "Quick add",
  connector: "Claude",
  chat: "Chat",
}

/** Soft tinted backgrounds / borders per accent (static classes for Tailwind). */
export const tint: Record<
  Accent,
  { bg: string; border: string; text: string; solid: string }
> = {
  hab: {
    bg: "bg-hab/12",
    border: "border-hab/30",
    text: "text-hab",
    solid: "bg-hab",
  },
  tsk: {
    bg: "bg-tsk/12",
    border: "border-tsk/30",
    text: "text-tsk",
    solid: "bg-tsk",
  },
  fit: {
    bg: "bg-fit/12",
    border: "border-fit/30",
    text: "text-fit",
    solid: "bg-fit",
  },
  nut: {
    bg: "bg-nut/12",
    border: "border-nut/30",
    text: "text-nut",
    solid: "bg-nut",
  },
  foc: {
    bg: "bg-foc/12",
    border: "border-foc/30",
    text: "text-foc",
    solid: "bg-foc",
  },
  fin: {
    bg: "bg-fin/12",
    border: "border-fin/30",
    text: "text-fin",
    solid: "bg-fin",
  },
  life: {
    bg: "bg-life/12",
    border: "border-life/30",
    text: "text-life",
    solid: "bg-life",
  },
  primary: {
    bg: "bg-primary/12",
    border: "border-primary/30",
    text: "text-primary",
    solid: "bg-primary",
  },
}

export function AiAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-hab text-white shadow-sm",
        className,
      )}
    >
      <Sparkles className="size-3.5" />
    </div>
  )
}

/** Bottom sheet used for Capture's overlays (voice, photo, quick add, edit). */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "mx-auto max-h-[90dvh] max-w-md gap-0 rounded-t-3xl border-border/60 p-0",
          FOCUS,
          NO_DEFAULT_CLOSE,
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-muted" />
        <SheetCloseButton />
        <SheetHeader className="px-5 pt-3 pr-14 pb-2">
          <SheetTitle className="font-display text-xl">{title}</SheetTitle>
          <SheetDescription className={cn(!description && "sr-only")}>
            {description ?? "Capture"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && (
          <div className="pb-safe border-border/60 border-t px-5 pt-3 pb-4">
            {footer}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function Toggle({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <Switch
      checked={on}
      onChange={onChange}
      label={label}
      disabled={disabled}
    />
  )
}

export const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
  })

export function dayLabel(key: string, today: string) {
  if (key === today) return "Today"
  const y = new Date(`${today}T12:00:00`)
  y.setDate(y.getDate() - 1)
  const yk = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`
  if (key === yk) return "Yesterday"
  return new Date(`${key}T12:00:00`).toLocaleDateString("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}
