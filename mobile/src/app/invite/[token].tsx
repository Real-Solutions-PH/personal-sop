import { type Href, Redirect, useLocalSearchParams } from "expo-router"
import { setPendingInvite } from "@/prototype/pending-invite"
import { sessionStore } from "@/prototype/session"

// Where an invite link lands (personalsop://invite/<token>, from the page
// at https://<api host>/i/<token>). Signed in: the accept screen inside the
// app. Signed out: the token is kept, and once signed in (and through
// onboarding, for a new account) the app opens the accept screen.
export default function Page() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const signedIn = sessionStore.use((s) => s.signedIn)
  if (signedIn) return <Redirect href={`/finance/invite/${token}` as Href} />
  setPendingInvite(token)
  return <Redirect href="/welcome" />
}
