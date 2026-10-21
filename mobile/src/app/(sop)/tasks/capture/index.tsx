import { Redirect, useLocalSearchParams } from "expo-router"

// The old free-text task capture screen; adding a task is a plain form now
// and free text goes to Fern (ADR-0015). Kept so existing links still land.
export default function Page() {
  const p = useLocalSearchParams<Record<string, string>>()
  return <Redirect href={{ pathname: "/tasks/new", params: p }} />
}
