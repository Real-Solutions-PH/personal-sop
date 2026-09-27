import { RoutineFormScreen } from "@/proto/habits/screens/routines"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <RoutineFormScreen id={id} />
}
