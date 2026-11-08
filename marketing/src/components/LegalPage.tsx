import { SITE } from "@/config/site"
import { Logo } from "./Logo"
import { SiteFooter } from "./SiteFooter"

// A legal page shell. The body is a PLACEHOLDER until counsel-reviewed text
// exists; the notice says so on the page instead of passing off an outline
// as a policy.
export function LegalPage({
  title,
  outline,
}: {
  title: string
  outline: { heading: string; body: string }[]
}) {
  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Logo />
          <a className="btn btn-outline btn-sm" href="/">
            Back to home
          </a>
        </div>
      </header>
      <main id="main" className="wrap">
        <article className="legal">
          <h1>{title}</h1>
          <p className="placeholder-note">
            This page is a draft outline. The full text is being written and
            will be published before Unfurl opens to the public. Questions:{" "}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>
          {outline.map((s) => (
            <section key={s.heading} style={{ padding: 0 }}>
              <h2>{s.heading}</h2>
              <p>{s.body}</p>
            </section>
          ))}
        </article>
      </main>
      <SiteFooter />
    </>
  )
}
