"use client"

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Copy,
  Info,
  Mail,
  Send,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  CLOSE,
  MODULES,
  type ModuleQ,
  type Persona,
  route,
  S5C,
  SCREENER,
  type ScreenerAnswers,
} from "@/config/interview"
import { SITE } from "@/config/site"
import { type InterviewPayload, submitInterview } from "@/lib/submitInterview"

type Step = "screener" | "module" | "close" | "done" | "underage"

const STEP_NO: Partial<Record<Step, number>> = {
  screener: 1,
  module: 2,
  close: 3,
}

// The branching customer interview: screener → one persona's questions →
// close. Answers stay in the page until the visitor sends them; nothing is
// stored in the browser.
export function Interview() {
  const [step, setStep] = useState<Step>("screener")
  const [screener, setScreener] = useState<ScreenerAnswers>({})
  const [s5c, setS5c] = useState("")
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [z1, setZ1] = useState("")
  const [email, setEmail] = useState("")
  const [call, setCall] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<"sent" | "stub" | "error" | null>(null)
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  const routed = route(screener)
  const module = MODULES[routed.persona]
  const questions: ModuleQ[] = [...module.questions, ...routed.extras]

  // Runs on every step change to move focus to the new step's heading.
  // biome-ignore lint/correctness/useExhaustiveDependencies: step is the trigger
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    headRef.current?.focus()
    headRef.current?.scrollIntoView({ block: "start" })
  }, [step])

  function pick(id: string, value: string, multi: boolean) {
    setMissing((m) => m.filter((x) => x !== id))
    setScreener((s) => {
      if (!multi) return { ...s, [id]: value }
      const cur = (s[id] as string[] | undefined) ?? []
      if (value === "none")
        return { ...s, [id]: cur.includes("none") ? [] : ["none"] }
      const without = cur.filter((v) => v !== "none")
      return {
        ...s,
        [id]: without.includes(value)
          ? without.filter((v) => v !== value)
          : [...without, value],
      }
    })
  }

  function nextFromScreener() {
    const gaps = SCREENER.filter((q) => {
      const v = screener[q.id]
      return q.kind === "multi" ? !(v as string[] | undefined)?.length : !v
    }).map((q) => q.id)
    setMissing(gaps)
    if (gaps.length) return
    if (screener.S1 === "under18") {
      setStep("underage")
      return
    }
    setStep("module")
  }

  function payload(): InterviewPayload {
    const asked = new Set(questions.map((q) => q.id))
    return {
      kit: "2026-11-08",
      submittedAt: new Date().toISOString(),
      persona: routed.persona as Persona,
      tag: routed.tag,
      relation: "website",
      screener: { ...screener, S5c: s5c.trim() || undefined },
      answers: Object.fromEntries(
        Object.entries(answers).filter(([k, v]) => asked.has(k) && v.trim()),
      ),
      close: {
        Z1: z1.trim() || undefined,
        email: email.trim() || undefined,
        followUpCall: call && !!email.trim(),
      },
    }
  }

  function asText(p: InterviewPayload) {
    const lines = [
      `Unfurl interview (kit ${p.kit}), persona ${p.persona}${p.tag ? ` (${p.tag})` : ""}`,
      ...Object.entries(p.screener)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`),
      ...questions
        .filter((q) => p.answers[q.id])
        .map((q) => `${q.id}. ${q.text}\n${p.answers[q.id]}`),
      p.close.Z1 ? `Z1: ${p.close.Z1}` : "",
      p.close.email ? `Email: ${p.close.email}` : "",
      `Follow-up call: ${p.close.followUpCall ? "yes" : "no"}`,
    ]
    return lines.filter(Boolean).join("\n\n")
  }

  async function send() {
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setMissing(["email"])
      return
    }
    setMissing([])
    setSending(true)
    try {
      const r = await submitInterview(payload())
      setResult(r.sent ? "sent" : "stub")
      setStep("done")
    } catch {
      setResult("error")
    } finally {
      setSending(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(payload()))
      setCopied("ok")
    } catch {
      setCopied("fail")
    }
  }

  const stepNo = STEP_NO[step]

  return (
    <div className="interview">
      {stepNo && (
        <p className="iv-progress">
          Step {stepNo} of 3
          <span className="iv-bar" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= stepNo ? "on" : ""} />
            ))}
          </span>
        </p>
      )}

      {step === "screener" && (
        <>
          <h2 className="iv-title" ref={headRef} tabIndex={-1}>
            A bit about you
          </h2>
          <p className="iv-sub">
            Seven quick questions. They decide which questions come next.
          </p>
          {SCREENER.map((q) => {
            const v = screener[q.id]
            const isMissing = missing.includes(q.id)
            return (
              <fieldset
                key={q.id}
                className={`iv-q ${isMissing ? "miss" : ""}`}
              >
                <legend>{q.text}</legend>
                <div className="iv-choices">
                  {q.choices.map((c) => {
                    const on =
                      q.kind === "multi"
                        ? ((v as string[] | undefined) ?? []).includes(c.value)
                        : v === c.value
                    return (
                      <label key={c.value} className="iv-choice">
                        <input
                          className="sr-only"
                          type={q.kind === "single" ? "radio" : "checkbox"}
                          name={q.id}
                          value={c.value}
                          checked={on}
                          onChange={() =>
                            pick(q.id, c.value, q.kind === "multi")
                          }
                        />
                        {on && <Check aria-hidden />}
                        {c.label}
                      </label>
                    )
                  })}
                </div>
                {isMissing && (
                  <p className="iv-err">
                    <CircleAlert aria-hidden /> Pick one to continue.
                  </p>
                )}
                {q.id === "S5b" && v === "yes" && (
                  <label className="iv-field">
                    <span className="iv-label">{S5C.text}</span>
                    <input
                      value={s5c}
                      onChange={(e) => setS5c(e.target.value)}
                      placeholder={S5C.placeholder}
                    />
                  </label>
                )}
              </fieldset>
            )
          })}
          <div className="iv-nav">
            <span />
            <button
              type="button"
              className="btn btn-primary"
              onClick={nextFromScreener}
            >
              Next
              <ArrowRight aria-hidden />
            </button>
          </div>
          {missing.length > 0 && (
            <p className="iv-err" role="alert">
              <CircleAlert aria-hidden /> {missing.length} question
              {missing.length > 1 ? "s" : ""} above still need an answer.
            </p>
          )}
        </>
      )}

      {step === "module" && (
        <>
          <h2 className="iv-title" ref={headRef} tabIndex={-1}>
            {module.name}
          </h2>
          <p className="iv-sub">
            {module.intro} Answer as many as you like; skip any.
          </p>
          {questions.map((q, i) => (
            <label key={q.id} className="iv-field iv-open">
              <span className="iv-label">
                <b className="num">{i + 1}.</b> {q.text}
              </span>
              <textarea
                rows={3}
                value={answers[q.id] ?? ""}
                onChange={(e) =>
                  setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                }
                placeholder={q.probe}
              />
            </label>
          ))}
          <div className="iv-nav">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setStep("screener")}
            >
              <ArrowLeft aria-hidden />
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep("close")}
            >
              Next
              <ArrowRight aria-hidden />
            </button>
          </div>
        </>
      )}

      {step === "close" && (
        <>
          <h2 className="iv-title" ref={headRef} tabIndex={-1}>
            Last one
          </h2>
          <p className="iv-pitch">{CLOSE.pitch}</p>
          <label className="iv-field iv-open">
            <span className="iv-label">{CLOSE.Z1.text}</span>
            <textarea
              rows={3}
              value={z1}
              onChange={(e) => setZ1(e.target.value)}
              placeholder={CLOSE.Z1.placeholder}
            />
          </label>
          <label
            className={`iv-field ${missing.includes("email") ? "miss" : ""}`}
          >
            <span className="iv-label">
              Email (optional): to try it on TestFlight or talk to us
            </span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. alex@example.com"
            />
          </label>
          {missing.includes("email") && (
            <p className="iv-err" role="alert">
              <CircleAlert aria-hidden /> That email looks incomplete. Fix it,
              or leave it empty.
            </p>
          )}
          <label className="iv-check">
            <input
              className="sr-only"
              type="checkbox"
              checked={call}
              onChange={(e) => setCall(e.target.checked)}
            />
            <span className="box" aria-hidden="true">
              {call && <Check />}
            </span>
            I'm happy to join a 30-minute follow-up call.
          </label>
          {call && !email.trim() && (
            <p className="iv-note">
              <Info aria-hidden /> Add your email above so we can arrange the
              call.
            </p>
          )}
          <p className="iv-note">
            <Info aria-hidden /> Your answers are read by the Unfurl team to
            decide what to build. We use your email only to reply to you.
          </p>
          <div className="iv-nav">
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setStep("module")}
            >
              <ArrowLeft aria-hidden />
              Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={send}
              disabled={sending}
            >
              {sending ? "Sending…" : "Send my answers"}
              <Send aria-hidden />
            </button>
          </div>
          {result === "error" && (
            <p className="iv-err" role="alert">
              <CircleAlert aria-hidden /> Couldn't send your answers. Check your
              connection and try again; nothing is lost.
            </p>
          )}
        </>
      )}

      {step === "done" && (
        <>
          <h2 className="iv-title" ref={headRef} tabIndex={-1}>
            Thank you
          </h2>
          {result === "sent" ? (
            <p className="iv-msg" data-tone="good">
              <CircleCheck aria-hidden /> Your answers are in. They go straight
              into what we build next.
            </p>
          ) : (
            <div className="iv-msg" data-tone="info" data-stub="interview">
              <Info aria-hidden />
              <div>
                <p>
                  Sending isn't connected yet, so your answers are still only on
                  this page. Copy them or email them to us so they aren't lost.
                </p>
                <div className="cta-row" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={copy}
                  >
                    <Copy aria-hidden />
                    {copied === "ok" ? "Copied" : "Copy my answers"}
                  </button>
                  <a
                    className="btn btn-outline btn-sm"
                    href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent("Unfurl interview answers")}&body=${encodeURIComponent(asText(payload()).slice(0, 1800))}`}
                  >
                    <Mail aria-hidden />
                    Email them
                  </a>
                </div>
                {copied === "fail" && (
                  <p className="iv-err">
                    <CircleAlert aria-hidden /> Couldn't copy. Use "Email them"
                    instead.
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="iv-sub" style={{ marginTop: 24 }}>
            Want Unfurl when it opens?{" "}
            <a href="/#waitlist">Join the waitlist</a>.
          </p>
        </>
      )}

      {step === "underage" && (
        <>
          <h2 className="iv-title" ref={headRef} tabIndex={-1}>
            Thanks for stopping by
          </h2>
          <p className="iv-sub">
            These questions are for people 18 and over, so we'll stop here.
            Nothing you picked has been sent.
          </p>
        </>
      )}
    </div>
  )
}
