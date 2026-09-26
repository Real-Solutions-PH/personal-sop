import type { Metadata } from "next"
import Settings from "./settings"

export const metadata: Metadata = {
  title: "Settings - FastAPI Template",
}

export default function Page() {
  return <Settings />
}
