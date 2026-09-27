import { HabitFormScreen } from "@/proto/habits/screens/form"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <HabitFormScreen id={id} />
}
