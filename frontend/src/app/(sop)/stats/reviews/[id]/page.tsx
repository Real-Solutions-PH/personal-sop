"use client"

import { useParams } from "next/navigation"
import { ReviewScreen } from "@/proto/dash/reviews"

export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <ReviewScreen id={decodeURIComponent(id)} />
}
