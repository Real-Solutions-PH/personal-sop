"use client"

import { useParams } from "next/navigation"
import { ListScreen } from "@/proto/tasks/screens/list"

export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <ListScreen key={id} id={id} />
}
