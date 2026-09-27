import { TimerScreen } from "@/proto/habits/screens/timer"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <TimerScreen id={id} />
}
