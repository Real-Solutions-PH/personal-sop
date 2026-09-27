import type { ReactNode } from "react"
import { FinSheets } from "@/proto/finance/sheets"

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <FinSheets />
    </>
  )
}
