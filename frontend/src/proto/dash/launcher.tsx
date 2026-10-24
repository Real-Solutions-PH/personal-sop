"use client"

import {
  BookOpen,
  CheckSquare,
  Dumbbell,
  type LucideIcon,
  Target,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import type { ModuleKey } from "../contract"
import { type Accent, accentText, SectionTitle } from "../ui/kit"
import { useEnabled } from "./hooks"

// Explicit way into each module's home. Module cards on Today are for acting on
// today's items; this row is plain navigation.
const APPS: {
  key: ModuleKey | "journal"
  label: string
  href: string
  icon: LucideIcon
  accent: Accent
}[] = [
  {
    key: "habits",
    label: "Habits",
    href: "/habits",
    icon: Target,
    accent: "hab",
  },
  {
    key: "tasks",
    label: "Tasks",
    href: "/tasks",
    icon: CheckSquare,
    accent: "tsk",
  },
  {
    key: "fitness",
    label: "Fitness",
    href: "/fitness",
    icon: Dumbbell,
    accent: "fit",
  },
  {
    key: "finance",
    label: "Finance",
    href: "/finance",
    icon: Wallet,
    accent: "fin",
  },
  {
    key: "journal",
    label: "Journal",
    href: "/journal",
    icon: BookOpen,
    accent: "life",
  },
]

const tint: Record<Accent, string> = {
  hab: "bg-hab/15",
  tsk: "bg-tsk/15",
  fit: "bg-fit/15",
  nut: "bg-nut/15",
  foc: "bg-foc/15",
  fin: "bg-fin/15",
  life: "bg-life/15",
  primary: "bg-primary/15",
}

export function AppLauncher({ title }: { title?: string }) {
  const enabled = useEnabled()
  const apps = APPS.filter((a) => a.key === "journal" || enabled[a.key])
  return (
    <nav aria-label="Apps">
      {title && <SectionTitle>{title}</SectionTitle>}
      <div className="grid grid-cols-5 gap-1">
        {apps.map((a) => (
          <Link
            key={a.key}
            href={a.href}
            className="group flex flex-col items-center gap-1.5 rounded-2xl py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={`grid size-14 place-items-center rounded-2xl transition-transform duration-150 group-active:scale-95 ${tint[a.accent]}`}
            >
              <a.icon
                className={`size-6 ${accentText[a.accent]}`}
                aria-hidden="true"
              />
            </span>
            <span className="font-medium text-xs">{a.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
