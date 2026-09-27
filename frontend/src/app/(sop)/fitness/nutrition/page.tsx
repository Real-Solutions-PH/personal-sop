import { redirect } from "next/navigation"

// Nutrition lives in Fitness → Eat now; keep old links (Today card, notifications) working.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>
}) {
  const { day } = await searchParams
  redirect(day ? `/fitness?tab=eat&day=${day}` : "/fitness?tab=eat")
}
