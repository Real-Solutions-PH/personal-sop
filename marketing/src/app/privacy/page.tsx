import type { Metadata } from "next"
import { LegalPage } from "@/components/LegalPage"

export const metadata: Metadata = {
  title: "Privacy policy",
  alternates: { canonical: "/privacy/" },
  robots: { index: false },
}

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy policy"
      outline={[
        {
          heading: "What we collect",
          body: "The records you create (habits, tasks, workouts, meals, money, journal and focus), the messages, voice notes and photos you send to Fern, your account email, and when you open and close the app or share a card, so we can see how often Unfurl is used.",
        },
        {
          heading: "Where it is stored",
          body: "On your phone first. With an account, a copy is kept on our servers so Fern can answer from your records and so your history moves to a new phone.",
        },
        {
          heading: "How Fern uses it",
          body: "To file what you say into records and to answer your questions about them. To do this, your messages, voice notes and photos are sent to a language model service.",
        },
        {
          heading: "Research answers",
          body: "If you answer the questions on the Help shape Unfurl page, we keep your answers, and your email if you give it, to decide what to build and to reply to you.",
        },
        {
          heading: "Your choices",
          body: "Export every record at any time. How to delete your account and its server copy will be set out here.",
        },
      ]}
    />
  )
}
