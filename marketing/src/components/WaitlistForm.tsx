"use client"

import {
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Info,
  Lock,
} from "lucide-react"
import { type FormEvent, useEffect, useState } from "react"
import { BROWSER_VERSION, CTA, SITE, WAITLIST } from "@/config/site"

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; email: string; browser: boolean }
  | { kind: "error"; message: string }
  | { kind: "stub" }

// The waitlist form. There is no backend yet (WAITLIST.endpoint is null), so
// submitting says exactly that and offers email instead; it never shows a
// success it did not earn. Once an endpoint is set, it POSTs
// {"email", "browserVersion"}; browserVersion is the demand signal for the
// unbuilt browser version.
export function WaitlistForm() {
  const [state, setState] = useState<State>({ kind: "idle" })
  const [browser, setBrowser] = useState(false)

  // The "join that list" link under every primary button lands on
  // #browser-list and arrives with the box already ticked.
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#browser-list") setBrowser(true)
    }
    sync()
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get("email") ?? "")
      .trim()
      .toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setState({
        kind: "error",
        message: "That email looks incomplete. Check it and try again.",
      })
      return
    }
    if (!WAITLIST.endpoint) {
      setState({ kind: "stub" })
      return
    }
    setState({ kind: "sending" })
    try {
      const res = await fetch(WAITLIST.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, browserVersion: browser }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState({ kind: "done", email, browser })
    } catch {
      setState({
        kind: "error",
        message:
          "Couldn't add you just now. Check your connection and try again.",
      })
    }
  }

  return (
    <form className="waitlist" onSubmit={onSubmit} noValidate>
      <label htmlFor="email">Your email</label>
      <div className="field-row">
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="e.g. alex@example.com"
          required
          aria-describedby="waitlist-msg"
          aria-invalid={state.kind === "error" ? true : undefined}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={state.kind === "sending"}
        >
          {state.kind === "sending" ? "Adding you…" : CTA.primaryLabel}
          <ArrowRight aria-hidden />
        </button>
      </div>
      {BROWSER_VERSION.listed && (
        <label className="iv-check browser-check" id="browser-list">
          <input
            className="sr-only"
            type="checkbox"
            name="browserVersion"
            checked={browser}
            onChange={(e) => setBrowser(e.target.checked)}
          />
          <span className="box" aria-hidden="true">
            {browser && <Check />}
          </span>
          Also tell me about a browser version for any computer. It isn't built
          yet.
        </label>
      )}
      <div id="waitlist-msg" aria-live="polite">
        {state.kind === "done" && (
          <p className="form-msg" data-tone="good">
            <CircleCheck aria-hidden /> You're on the list as {state.email}
            {state.browser ? ", for the app and the browser version" : ""}. One
            email when your invite is ready, nothing else.{" "}
            <a href="/research/">Got 10 minutes? Help shape Unfurl.</a>
          </p>
        )}
        {state.kind === "error" && (
          <p className="form-msg" data-tone="bad">
            <CircleAlert aria-hidden /> {state.message}
          </p>
        )}
        {state.kind === "stub" && (
          <p className="form-msg" data-tone="info" data-stub="waitlist">
            <Info aria-hidden />
            <span>
              {SITE.contactEmailLive ? (
                <>
                  Sign-ups aren't connected yet. Email{" "}
                  <a
                    href={`mailto:${SITE.contactEmail}?subject=Unfurl%20waitlist`}
                  >
                    {SITE.contactEmail}
                  </a>{" "}
                  to ask for an invite.
                </>
              ) : (
                <>Sign-ups open soon; nothing was saved. Please check back.</>
              )}{" "}
              Meanwhile, <a href="/research/">help shape Unfurl</a> in 10
              minutes.
            </span>
          </p>
        )}
      </div>
      <p className="reassure">
        <Lock aria-hidden /> One email when your invite is ready. No spam, no
        sharing.
      </p>
    </form>
  )
}
