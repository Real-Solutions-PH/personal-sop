import type { ReactNode } from "react"
import { FitToaster } from "@/proto/fitness/ui"

export default function FitnessLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <FitToaster />
    </>
  )
}
