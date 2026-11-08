import { MEDIA_CREDITS, SITE } from "@/config/site"
import { Logo } from "./Logo"

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="footer-grid">
          <div>
            <Logo />
            <p style={{ marginTop: 8 }}>{SITE.tagline}</p>
            <p style={{ marginTop: 4 }}>
              Made by {SITE.company}. Unfurl is not a medical, nutrition or
              financial service.
            </p>
          </div>
          <div>
            <h3>Product</h3>
            <ul>
              <li>
                <a href="/#demo">How it works</a>
              </li>
              <li>
                <a href="/#pricing">Pricing</a>
              </li>
              <li>
                <a href="/#faq">FAQ</a>
              </li>
              <li>
                <a href="/#waitlist">Join the waitlist</a>
              </li>
              <li>
                <a href="/research/">Help shape Unfurl</a>
              </li>
            </ul>
          </div>
          <div>
            <h3>Company</h3>
            <ul>
              <li>
                <a href="/privacy/">Privacy policy</a>
              </li>
              <li>
                <a href="/terms/">Terms of use</a>
              </li>
              <li>
                <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
              </li>
            </ul>
          </div>
        </div>
        <p className="credits">
          © 2026 {SITE.company}. Film music:{" "}
          {MEDIA_CREDITS.map((c) => (
            <span key={c.work}>
              “{c.work}” by{" "}
              <a href={c.url} rel="noopener">
                {c.author}
              </a>{" "}
              ({c.license}).
            </span>
          ))}
        </p>
      </div>
    </footer>
  )
}
