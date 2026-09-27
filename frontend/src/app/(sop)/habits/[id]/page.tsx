import { HabitDetailScreen } from "@/proto/habits/screens/detail"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <HabitDetailScreen id={id} />
}
