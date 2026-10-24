import { Redirect, useLocalSearchParams } from "expo-router"
// Moved to /nutrition/history when Nutrition became its own module
// (ADR-0024); old links (notifications, widgets, Fern's cards) land here.
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Redirect href={{ pathname: "/nutrition/history", params: p }} />
}
