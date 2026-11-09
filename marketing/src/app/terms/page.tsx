import type { Metadata } from "next"
import { LegalPage } from "@/components/LegalPage"

export const metadata: Metadata = {
  title: "Terms of use",
  alternates: { canonical: "/terms/" },
  robots: { index: false },
}

export default function Terms() {
  return (
    <LegalPage
      title="Terms of use"
      outline={[
        {
          heading: "The service",
          body: "Unfurl is a personal tracker. Fern's answers and photo estimates are for your own records, not medical, nutrition or financial advice.",
        },
        {
          heading: "Plans and limits",
          body: "The free plan includes a daily Fern allowance. Paid plans carry a fair-use limit stated in the app. Subscriptions are billed and cancelled through the App Store or Google Play.",
        },
        {
          heading: "Your content",
          body: "What you log stays yours. You give us permission to store and process it only to run the service for you.",
        },
      ]}
    />
  )
}
