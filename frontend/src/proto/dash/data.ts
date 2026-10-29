import {
  Dumbbell,
  ListChecks,
  type LucideIcon,
  Repeat,
  Smartphone,
  Timer,
  Utensils,
  Wallet,
} from "lucide-react"
import type { ModuleKey } from "../contract"
export const AREA: Record<
  ModuleKey,
  {
    label: string
    accent: "hab" | "tsk" | "fit" | "nut" | "foc" | "fin" | "scr"
    icon: LucideIcon
  }
> = {
  habits: { label: "Habits", accent: "hab", icon: Repeat },
  tasks: { label: "Tasks", accent: "tsk", icon: ListChecks },
  fitness: { label: "Fitness", accent: "fit", icon: Dumbbell },
  nutrition: { label: "Nutrition", accent: "nut", icon: Utensils },
  focus: { label: "Focus", accent: "foc", icon: Timer },
  finance: { label: "Finance", accent: "fin", icon: Wallet },
  screen: { label: "Screen time", accent: "scr", icon: Smartphone },
}

export * from "../../../../shared/prototype/dash/data"
