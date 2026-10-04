import { Redirect } from "expo-router"
import { BadgeCheck, MailCheck } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Text, type TextInput } from "react-native"
import { toast } from "sonner-native"
import {
  AuthButton,
  AuthScreen,
  Badge,
  CodeInput,
  clock,
  DemoTip,
  haptic,
  Rise,
  TextLink,
  useCountdown,
  useSubmit,
} from "../auth-kit"
import { back, replace } from "../navigation"
import {
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
  const [resending, setResending] = useState(false)
  const input = useRef<TextInput>(null)
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
    const id = setTimeout(() => {
      completeSignUp()
      replace("/onboarding")
    }, 1100)
    return () => clearTimeout(id)
  }, [verified])

  if (!pending && !verified) return <Redirect href="/signup" />
  if (verified)
    return (
      <AuthScreen
        showBack={false}
        badge={<Badge icon={BadgeCheck} tone="good" />}
        title="You're verified"
        subtitle="Setting up your Personal SOP…"
      >
        <ActivityIndicator
          accessibilityLabel="Setting up your account"
          color={t.primary}
          style={{ alignSelf: "flex-start" }}
        />
      </AuthScreen>
    )

  return (
    <AuthScreen
      badge={<Badge icon={MailCheck} />}
      title="Check your email"
      subtitle={
        <>
          Enter the 6-digit code we sent to{" "}
          <Text style={{ fontFamily: fonts.semibold, color: t.text }}>
            {maskEmail(pending?.email ?? "")}
          </Text>
        </>
      }
      footer={
        <TextLink onPress={() => back("/signup")}>
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
            fontFamily: fonts.medium,
            fontSize: 14,
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
                fontFamily: fonts.semibold,
                fontVariant: ["tabular-nums"],
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
              toast.success("New code sent", {
                description: `Check ${maskEmail(pending?.email ?? "")}`,
              })
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
