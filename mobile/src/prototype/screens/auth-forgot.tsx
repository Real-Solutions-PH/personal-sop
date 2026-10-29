import { KeyRound, Mail, MailCheck } from "lucide-react-native"
import { useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { Linking, Platform, Text, View } from "react-native"
import { toast } from "sonner-native"
import {
  AuthButton,
  AuthField,
  AuthScreen,
  Badge,
  clock,
  DemoTip,
  ErrorBanner,
  haptic,
  Rise,
  SwitchPrompt,
  TextLink,
  useCountdown,
  useSubmit,
} from "../auth-kit"
import { back, go } from "../navigation"
import {
  emailError,
  maskEmail,
  requestPasswordReset,
  sessionStore,
  takeHandoffEmail,
} from "../session"
import { fonts, useTheme } from "../theme"

async function openMailApp() {
  try {
    await Linking.openURL(Platform.OS === "ios" ? "message:" : "mailto:")
  } catch {
    toast.error("No mail app found", {
      description: "Open your email from your phone's home screen.",
    })
  }
}

export function ForgotPassword() {
  const t = useTheme()
  const remembered = sessionStore.use((s) => s.rememberedEmail)
  const [email, setEmail] = useState(() => takeHandoffEmail() || remembered)
  const [touched, setTouched] = useState(false)
  const [sent, setSent] = useState(false)
  const [resending, setResending] = useState(false)
  const input = useRef<TextInputInstance>(null)
  const submit = useSubmit()
  const { left, restart } = useCountdown(30)
  const error = emailError(email)
  const toSignIn = () => back("/login")

  const send = async () => {
    setTouched(true)
    if (error) {
      haptic.error()
      input.current?.focus()
      return
    }
    const ok = await submit.run(() => requestPasswordReset(email))
    if (ok) {
      haptic.success()
      restart()
      setSent(true)
    }
  }

  if (sent)
    return (
      <AuthScreen
        key="sent"
        onBack={() => setSent(false)}
        badge={<Badge icon={MailCheck} tone="good" />}
        title="Check your inbox"
        subtitle={
          <>
            If an account exists for{" "}
            <Text style={{ fontFamily: fonts.medium, color: t.text }}>
              {maskEmail(email)}
            </Text>
            , you'll get a link to reset your password. It expires in 30
            minutes.
          </>
        }
        footer={
          <SwitchPrompt
            question="Remembered it?"
            action="Back to sign in"
            onPress={toSignIn}
          />
        }
      >
        <Rise i={1} style={{ gap: 10 }}>
          <AuthButton
            onPress={openMailApp}
            icon={<Mail size={18} color={t.onPrimary} />}
          >
            Open mail app
          </AuthButton>
          <AuthButton tone="secondary" onPress={() => go("/reset-password")}>
            I have the link
          </AuthButton>
        </Rise>
        <Rise i={2} style={{ alignItems: "center", marginTop: 12 }}>
          {left > 0 ? (
            <Text
              accessibilityLiveRegion="polite"
              style={{
                minHeight: 44,
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
                await requestPasswordReset(email)
                setResending(false)
                restart()
                haptic.success()
                toast.success("Reset link sent again")
              }}
            >
              {resending ? "Sending…" : "Resend link"}
            </TextLink>
          )}
          <TextLink onPress={() => setSent(false)}>
            Use a different email
          </TextLink>
          <DemoTip>
            No email is sent. Tap “I have the link” to continue as if you'd
            opened it.
          </DemoTip>
        </Rise>
      </AuthScreen>
    )

  return (
    <AuthScreen
      key="form"
      onBack={toSignIn}
      badge={<Badge icon={KeyRound} />}
      title="Forgot your password?"
      subtitle="Enter the email you signed up with and we'll send you a link to reset it."
      footer={
        <SwitchPrompt
          question="Remembered it?"
          action="Back to sign in"
          onPress={toSignIn}
        />
      }
    >
      {submit.error && (
        <ErrorBanner message={submit.error} shakeKey={submit.shakeKey} />
      )}
      <Rise i={1}>
        <AuthField
          ref={input}
          label="Email"
          icon={Mail}
          value={email}
          onChangeText={setEmail}
          onBlur={() => setTouched((s) => s || !!email)}
          error={touched ? error : undefined}
          placeholder="name@example.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!email}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={send}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={2}>
        <View style={{ marginTop: 4 }}>
          <AuthButton
            onPress={send}
            loading={submit.busy}
            loadingLabel="Sending link…"
          >
            Send reset link
          </AuthButton>
        </View>
      </Rise>
    </AuthScreen>
  )
}
