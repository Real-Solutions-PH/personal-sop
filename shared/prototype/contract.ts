export type ModuleKey = "habits" | "tasks" | "fitness" | "finance"
export interface Metric {
  key: string
  label: string
  value: string
  delta?: number
  goodWhen?: "up" | "down"
  shareable: boolean
}
export interface CalendarItem {
  id: string
  day: string
  time?: string
  title: string
  module: ModuleKey
  done?: boolean
  href: string
}
export interface Miss {
  id: string
  day: string
  title: string
  module: ModuleKey
  href: string
}
export interface ModuleContract {
  key: ModuleKey
  label: string
  useAreaRate: (days: number, offset?: number) => number
  useMetrics: (days: number) => Metric[]
  useCalendar: (from: string, to: string) => CalendarItem[]
  useMisses: (from: string, to: string) => Miss[]
  useTodayProgress: () => {
    due: number
    done: number
  }
  href: string
}
