import type { Metadata } from "next"
import Items from "./items"

export const metadata: Metadata = {
  title: "Items - FastAPI Template",
}

export default function Page() {
  return <Items />
}
