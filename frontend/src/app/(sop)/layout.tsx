import type { ReactNode } from "react"
import { AppShell } from "@/proto/ui/shell"

export default function SopLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>
}
