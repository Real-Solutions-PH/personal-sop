import type { Metadata } from "next"
import { Interview } from "@/components/Interview"
import { Logo } from "@/components/Logo"
import { SiteFooter } from "@/components/SiteFooter"

export const metadata: Metadata = {
  title: "Help shape Unfurl",
  description:
    "Ten minutes about your own past with tracking apps: what you used, what made you stop, what you do now.",
  alternates: { canonical: "/research/" },
}

export default function Research() {
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Logo />
          <a className="btn btn-outline btn-sm keep" href="/">
            Back to home
          </a>
        </div>
      </header>
      <main id="main" className="wrap research">
        <span className="eyebrow">Help shape Unfurl</span>
        <h1>Tell us how tracking really went for you.</h1>
        <p className="lede">
          About 10 minutes. We ask about things that already happened, not what
          you'd like an app to do, because real stories are what we build from.
          Skip anything you'd rather not answer.
        </p>
        <Interview />
      </main>
      <SiteFooter />
    </>
  )
}
