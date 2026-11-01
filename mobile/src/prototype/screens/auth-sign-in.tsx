import { LockKeyhole, Mail } from "lucide-react-native"
import { useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { View } from "react-native"
import { toast } from "sonner-native"
import {
  AuthButton,
  AuthField,
  AuthScreen,
  Checkbox,
  DemoTip,
  ErrorBanner,
  haptic,
  OrDivider,
  PasswordField,
  Rise,
  SocialButtons,
  SwitchPrompt,
  TextLink,
  useSubmit,
} from "../auth-kit"
import { go, replace } from "../navigation"
import {
  continueWith,
  emailError,
  handOffEmail,
  sessionStore,
  signIn,
  takeHandoffEmail,
} from "../session"

export function SignIn() {
  const remembered = sessionStore.use((s) => s.rememberedEmail)
  const [email, setEmail] = useState(() => takeHandoffEmail() || remembered)
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [touched, setTouched] = useState({ email: false, password: false })
  const [social, setSocial] = useState<"apple" | "google" | null>(null)
  const passwordRef = useRef<TextInputInstance>(null)
  const emailRef = useRef<TextInputInstance>(null)
  const submit = useSubmit()

  const errors = {
    email: emailError(email),
    password: password ? undefined : "Enter your password",
  }
  const onSubmit = async () => {
    setTouched({ email: true, password: true })
    if (errors.email || errors.password) {
      haptic.error()
      ;(errors.email ? emailRef : passwordRef).current?.focus()
      return
    }
    const ok = await submit.run(() => signIn({ email, password, remember }))
    if (ok) {
      haptic.success()
      replace("/today")
    } else passwordRef.current?.focus()
  }
  const onSocial = async (provider: "apple" | "google") => {
    setSocial(provider)
    try {
      await continueWith(provider)
      haptic.success()
      replace("/today")
    } catch {
      setSocial(null)
      toast.error("Could not sign in. Please try again.")
    }
  }

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to pick up where today left off."
      footer={
        <SwitchPrompt
          question="New to Unfurl?"
          action="Create account"
          onPress={() => replace("/get-started")}
        />
      }
    >
      {submit.error && (
        <ErrorBanner
          message={submit.error}
          shakeKey={submit.shakeKey}
          action={
            <TextLink
              align="flex-start"
              onPress={() => {
                handOffEmail(email)
                go("/recover-password")
              }}
            >
              Reset your password
            </TextLink>
          }
        />
      )}
      <Rise i={1}>
        <AuthField
          ref={emailRef}
          label="Email"
          icon={Mail}
          value={email}
          onChangeText={(v) => {
            setEmail(v)
            submit.clear()
          }}
          onBlur={() =>
            setTouched((s) => ({ ...s, email: !!email || s.email }))
          }
          error={touched.email ? errors.email : undefined}
          placeholder="name@example.com"
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={2}>
        <PasswordField
          ref={passwordRef}
          label="Password"
          icon={LockKeyhole}
          value={password}
          onChangeText={(v) => {
            setPassword(v)
            submit.clear()
          }}
          onBlur={() =>
            setTouched((s) => ({ ...s, password: !!password || s.password }))
          }
          error={touched.password ? errors.password : undefined}
          placeholder="Your password"
          textContentType="password"
          autoComplete="current-password"
          returnKeyType="go"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onSubmit}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={3}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            marginTop: -6,
            marginBottom: 12,
          }}
        >
          <Checkbox
            label="Remember me"
            checked={remember}
            onChange={setRemember}
          />
          <TextLink
            onPress={() => {
              handOffEmail(email)
              go("/recover-password")
            }}
          >
            Forgot password?
          </TextLink>
        </View>
      </Rise>
      <Rise i={4}>
        <AuthButton
          onPress={onSubmit}
          loading={submit.busy}
          loadingLabel="Signing in…"
          disabled={!!social}
        >
          Sign in
        </AuthButton>
      </Rise>
      <Rise i={5}>
        <OrDivider label="or continue with" />
        <SocialButtons
          busy={social}
          onPress={onSocial}
          disabled={submit.busy}
        />
        <DemoTip>
          Any email works. Use the password “wrong” to see the error state.
        </DemoTip>
      </Rise>
    </AuthScreen>
  )
}
