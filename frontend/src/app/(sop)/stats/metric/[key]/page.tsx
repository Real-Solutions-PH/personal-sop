"use client"

import { useParams } from "next/navigation"
import { MetricDetailScreen } from "@/proto/dash/stats"

export default function Page() {
  const { key } = useParams<{ key: string }>()
  return <MetricDetailScreen metricKey={decodeURIComponent(key)} />
}
