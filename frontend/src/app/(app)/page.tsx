import type { Metadata } from "next"
import Dashboard from "./dashboard"

export const metadata: Metadata = {
  title: "Dashboard - FastAPI Template",
}

export default function Page() {
  return <Dashboard />
}
