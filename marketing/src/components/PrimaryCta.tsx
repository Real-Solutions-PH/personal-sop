import { ArrowRight, CircleCheck } from "lucide-react"
import type { ReactNode } from "react"
import { CTA } from "@/config/site"

// The one primary call to action, repeated after each proof section. Every
// copy goes to the same place with the same words, so the page asks for one
// thing only.
export function PrimaryCta({
  id,
  secondary,
  aside,
}: {
  id?: string
  secondary?: { label: string; href: string }
  /** Drawn beside the button, e.g. Fern looking at it. */
  aside?: ReactNode
}) {
  const href = CTA.appStoreUrl ?? CTA.primaryHref
  const label = CTA.appStoreUrl ? "Download on the App Store" : CTA.primaryLabel
  return (
    <div id={id}>
      <div className="cta-row">
        <a className="btn btn-primary" href={href}>
          {label}
          <ArrowRight aria-hidden />
        </a>
        {aside}
        {secondary && (
          <a className="btn btn-outline" href={secondary.href}>
            {secondary.label}
          </a>
        )}
      </div>
      <p className="reassure">
        <CircleCheck aria-hidden /> {CTA.reassurance}
      </p>
    </div>
  )
}
