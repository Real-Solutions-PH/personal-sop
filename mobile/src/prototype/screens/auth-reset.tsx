import { CircleCheckBig, LockKeyhole, ShieldCheck } from "lucide-react-native"
import { useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { Text } from "react-native"
import {
  AuthButton,
  AuthScreen,
  Badge,
  haptic,
  PasswordField,
  Rise,
  StrengthMeter,
  useSubmit,
} from "../auth-kit"
import { replace } from "../navigation"
import {
  maskEmail,
  passwordStrength,
  resetPassword,
  sessionStore,
} from "../session"
import { fonts, useTheme } from "../theme"

export function ResetPassword() {
  const t = useTheme()
  const email = sessionStore.use((s) => s.resetEmail)
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [touched, setTouched] = useState({ password: false, confirm: false })
  const [done, setDone] = useState(false)
  const refs = {
    password: useRef<TextInputInstance>(null),
    confirm: useRef<TextInputInstance>(null),
  }
  const submit = useSubmit()
  const strength = passwordStrength(password)
  const errors = {
    password: !password
      ? "Create a new password"
      : strength.acceptable
        ? undefined
        : "Use 8+ characters with at least 3 of the items below",
    confirm: !confirm
      ? "Re-enter your new password"
      : confirm !== password
        ? "Passwords don't match"
        : undefined,
  }
  const save = async () => {
    setTouched({ password: true, confirm: true })
    if (errors.password || errors.confirm) {
      haptic.error()
      ;(errors.password ? refs.password : refs.confirm).current?.focus()
      return
    }
    const ok = await submit.run(() => resetPassword(password))
    if (ok) {
      haptic.success()
      setDone(true)
    }
  }

  if (done)
    return (
      <AuthScreen
        key="done"
        showBack={false}
        badge={<Badge icon={CircleCheckBig} tone="good" />}
        title="Password updated"
        subtitle="Your password has been changed. Sign in with your new password to continue."
      >
        <Rise i={1}>
          <AuthButton onPress={() => replace("/login")}>
            Back to sign in
          </AuthButton>
        </Rise>
      </AuthScreen>
    )

  return (
    <AuthScreen
      key="form"
      onBack={() => replace("/login")}
      badge={<Badge icon={ShieldCheck} />}
      title="Set a new password"
      subtitle={
        email ? (
          <>
            For{" "}
            <Text style={{ fontFamily: fonts.medium, color: t.text }}>
              {maskEmail(email)}
            </Text>
            . Choose something you don't use anywhere else.
          </>
        ) : (
          "Choose something you don't use anywhere else."
        )
      }
    >
      <Rise i={1}>
        <PasswordField
          ref={refs.password}
          label="New password"
          icon={LockKeyhole}
          value={password}
          onChangeText={setPassword}
          onBlur={() =>
            setTouched((s) => ({ ...s, password: s.password || !!password }))
          }
          error={touched.password ? errors.password : undefined}
          placeholder="New password"
          textContentType="newPassword"
          autoComplete="new-password"
          autoFocus
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => refs.confirm.current?.focus()}
          editable={!submit.busy}
        />
        <StrengthMeter password={password} />
      </Rise>
      <Rise i={2}>
        <PasswordField
          ref={refs.confirm}
          label="Confirm new password"
          icon={LockKeyhole}
          value={confirm}
          onChangeText={setConfirm}
          onBlur={() =>
            setTouched((s) => ({ ...s, confirm: s.confirm || !!confirm }))
          }
          error={touched.confirm ? errors.confirm : undefined}
          hint={
            confirm && confirm === password ? (
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 13,
                  color: t.good,
                }}
              >
                Passwords match
              </Text>
            ) : undefined
          }
          placeholder="Repeat password"
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={save}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={3}>
        <AuthButton
          onPress={save}
          loading={submit.busy}
          loadingLabel="Updating password…"
        >
          Update password
        </AuthButton>
      </Rise>
    </AuthScreen>
  )
}
