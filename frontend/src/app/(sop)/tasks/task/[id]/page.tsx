"use client"

import { useParams } from "next/navigation"
import { TaskScreen } from "@/proto/tasks/screens/misc"

export default function Page() {
  const { id } = useParams<{ id: string }>()
  return <TaskScreen id={id} />
}
