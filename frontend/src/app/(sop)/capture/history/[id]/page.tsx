import { CaptureDetailScreen } from "@/proto/capture/screens/history"

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <CaptureDetailScreen id={id} />
}
