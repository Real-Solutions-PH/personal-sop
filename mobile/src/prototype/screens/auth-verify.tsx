import { Redirect } from "expo-router"
import { BadgeCheck, MailCheck } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { ActivityIndicator, Text } from "react-native"
import {
  AuthButton,
  AuthScreen,
  Badge,
  CodeInput,
  clock,
  DemoTip,
  ErrorBanner,
  haptic,
  Rise,
  TextLink,
  useCountdown,
  useSubmit,
} from "../auth-kit"
import { back, replace } from "../navigation"
import {
  AuthError,
  completeSignUp,
  maskEmail,
  resendCode,
  sessionStore,
  verifyEmail,
} from "../session"
import { fonts, useTheme } from "../theme"

export function VerifyEmail() {
  const t = useTheme()
  const pending = sessionStore.use((s) => s.pending)
  const [code, setCode] = useState("")
  const [verified, setVerified] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishTry, setFinishTry] = useState(0)
  const [resending, setResending] = useState(false)
  const input = useRef<TextInputInstance>(null)
  const submit = useSubmit()
  const { left, restart } = useCountdown(30)

  const verify = async (value: string) => {
    const ok = await submit.run(() => verifyEmail(value))
    if (!ok) {
      setCode("")
      input.current?.focus()
      return
    }
    setVerified(true)
    haptic.success()
  }
  useEffect(() => {
    if (!verified) return
    let alive = true
    setFinishError(null)
    const id = setTimeout(
      async () => {
        try {
          await completeSignUp()
          // Not gated on `alive`: signing in removes this route from the
          // stack (unmounting the screen) in the same tick.
          replace("/onboarding")
        } catch (e) {
          if (!alive) return
          // Taken while the code was on its way: pick another on Sign up.
          if (e instanceof AuthError && e.field === "username")
            replace("/signup")
          else {
            haptic.error()
            setFinishError(
              e instanceof Error ? e.message : "Something went wrong",
            )
          }
        }
      },
      finishTry ? 0 : 1100,
    )
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [verified, finishTry])

  if (!pending && !verified) return <Redirect href="/get-started" />
  if (verified)
    return (
      <AuthScreen
        showBack={false}
        badge={<Badge icon={BadgeCheck} tone="good" />}
        title="You're verified"
        subtitle="Setting up Unfurl…"
      >
        {finishError ? (
          <>
            <ErrorBanner message={finishError} shakeKey={finishTry} />
            <AuthButton onPress={() => setFinishTry((n) => n + 1)}>
              Try again
            </AuthButton>
          </>
        ) : (
          <ActivityIndicator
            accessibilityLabel="Setting up your account"
            color={t.primary}
            style={{ alignSelf: "flex-start" }}
          />
        )}
      </AuthScreen>
    )

  return (
    <AuthScreen
      badge={<Badge icon={MailCheck} />}
      title="Check your email"
      subtitle={
        <>
          Enter the 6-digit code we sent to{" "}
          <Text style={{ fontFamily: fonts.medium, color: t.text }}>
            {maskEmail(pending?.email ?? "")}
          </Text>
        </>
      }
      footer={
        <TextLink onPress={() => back("/get-started")}>
          Wrong email? Edit details
        </TextLink>
      }
    >
      <Rise i={1}>
        <CodeInput
          ref={input}
          value={code}
          onChange={(next) => {
            setCode(next)
            if (submit.error) submit.clear()
            if (next.length === 6 && !submit.busy) void verify(next)
          }}
          error={!!submit.error}
          shakeKey={submit.shakeKey}
          disabled={submit.busy}
        />
        <Text
          accessibilityLiveRegion="polite"
          style={{
            minHeight: 22,
            textAlign: "center",
            fontFamily: fonts.body,
            fontSize: 13,
            color: submit.error ? t.bad : t.muted,
            marginBottom: 12,
          }}
        >
          {submit.error ??
            (submit.busy ? "Checking code…" : "The code expires in 10 minutes")}
        </Text>
      </Rise>
      <Rise i={2}>
        <AuthButton
          onPress={() => void verify(code)}
          disabled={code.length < 6}
          loading={submit.busy}
          loadingLabel="Verifying…"
        >
          Verify email
        </AuthButton>
      </Rise>
      <Rise i={3} style={{ alignItems: "center", marginTop: 12 }}>
        {left > 0 ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              minHeight: 44,
              textAlignVertical: "center",
              paddingTop: 12,
              fontFamily: fonts.body,
              fontSize: 15,
              color: t.muted,
            }}
          >
            Didn't get it? Resend in{" "}
            <Text
              style={{
                fontFamily: fonts.mono,
                color: t.text,
              }}
            >
              {clock(left)}
            </Text>
          </Text>
        ) : (
          <TextLink
            onPress={async () => {
              if (resending) return
              setResending(true)
              await resendCode()
              setResending(false)
              restart()
              setCode("")
              submit.clear()
              haptic.success()
              input.current?.focus()
            }}
          >
            {resending ? "Sending…" : "Resend code"}
          </TextLink>
        )}
        <DemoTip>Any 6 digits work, except 000000.</DemoTip>
      </Rise>
    </AuthScreen>
  )
}
