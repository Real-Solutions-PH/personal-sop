import { Redirect, useLocalSearchParams } from "expo-router"

// The day's timeline lives at the bottom of the Focus page now; an old link
// to a day lands there, scrolled to that day.
export default function Page() {
  const { day } = useLocalSearchParams<{ day?: string }>()
  return (
    <Redirect href={day ? { pathname: "/focus", params: { day } } : "/focus"} />
  )
}
