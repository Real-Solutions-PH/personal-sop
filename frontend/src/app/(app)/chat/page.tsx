import type { Metadata } from "next"
import { notFound } from "next/navigation"
import Chat from "./chat"

export const metadata: Metadata = {
  title: "Chat - FastAPI Template",
}

export default function Page() {
  if (process.env.NEXT_PUBLIC_AI_ENABLED !== "true") {
    notFound()
  }
  return <Chat />
}
