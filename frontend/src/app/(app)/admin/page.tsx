import type { Metadata } from "next"
import Admin from "./admin"

export const metadata: Metadata = {
  title: "Admin - FastAPI Template",
}

export default function Page() {
  return <Admin />
}
