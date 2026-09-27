import { JournalEditorScreen } from "@/proto/capture/screens/journal"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <JournalEditorScreen key={id} id={id} />
}
