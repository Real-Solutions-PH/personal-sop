import { SummaryScreen } from "@/proto/habits/screens/player"

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ run?: string }>
}) {
  const { id } = await params
  const { run } = await searchParams
  return <SummaryScreen id={id} runId={run} />
}
