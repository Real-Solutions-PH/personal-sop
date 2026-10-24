import { Redirect, useLocalSearchParams } from "expo-router"
// Moved to /nutrition/meals/[id] when Nutrition became its own module
// (ADR-0024); old links (notifications, Fern's cards) land here.
export default function Page() {
  const p = useLocalSearchParams<Record<string, string> & { id: string }>()
  return <Redirect href={{ pathname: "/nutrition/meals/[id]", params: p }} />
}
