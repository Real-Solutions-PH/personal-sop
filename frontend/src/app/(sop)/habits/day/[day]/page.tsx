import { DayEditorScreen } from "@/proto/habits/screens/day"

export default async function Page({
  params,
}: {
  params: Promise<{ day: string }>
}) {
  const { day } = await params
  return <DayEditorScreen day={day} />
}
