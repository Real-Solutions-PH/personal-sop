"use client"

import { ArrowRight, CircleAlert, CircleCheck, Info, Lock } from "lucide-react"
import { type FormEvent, useState } from "react"
import { CTA, SITE, WAITLIST } from "@/config/site"

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "done"; email: string }
  | { kind: "error"; message: string }
  | { kind: "stub" }

// The waitlist form. There is no backend yet (WAITLIST.endpoint is null), so
// submitting says exactly that and offers email instead; it never shows a
// success it did not earn. Once an endpoint is set, it POSTs {"email"}.
export function WaitlistForm() {
  const [state, setState] = useState<State>({ kind: "idle" })

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
        body: JSON.stringify({ email }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setState({ kind: "done", email })
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
      <div id="waitlist-msg" aria-live="polite">
        {state.kind === "done" && (
          <p className="form-msg" data-tone="good">
            <CircleCheck aria-hidden /> You're on the list as {state.email}. One
            email when your invite is ready, nothing else.
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
              Sign-ups aren't connected yet. Email{" "}
              <a href={`mailto:${SITE.contactEmail}?subject=Unfurl%20waitlist`}>
                {SITE.contactEmail}
              </a>{" "}
              and you're first in line.
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
