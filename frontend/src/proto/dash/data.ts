import {
  Dumbbell,
  ListChecks,
  type LucideIcon,
  Repeat,
  Utensils,
  Wallet,
} from "lucide-react"
import type { ModuleKey } from "../contract"
export const AREA: Record<
  ModuleKey,
  {
    label: string
    accent: "hab" | "tsk" | "fit" | "nut" | "fin"
    icon: LucideIcon
  }
> = {
  habits: { label: "Habits", accent: "hab", icon: Repeat },
  tasks: { label: "Tasks", accent: "tsk", icon: ListChecks },
  fitness: { label: "Fitness", accent: "fit", icon: Dumbbell },
  nutrition: { label: "Nutrition", accent: "nut", icon: Utensils },
  finance: { label: "Finance", accent: "fin", icon: Wallet },
}

export * from "../../../../shared/prototype/dash/data"
