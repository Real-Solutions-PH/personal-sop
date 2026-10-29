import { AtSign, LockKeyhole, Mail, User } from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import type { TextInputInstance } from "react-native"
import { Text, View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import {
  AuthButton,
  AuthField,
  AuthScreen,
  Checkbox,
  DemoTip,
  ErrorBanner,
  FieldStatus,
  haptic,
  OrDivider,
  PasswordField,
  Rise,
  SocialButtons,
  StrengthMeter,
  SwitchPrompt,
  TextLink,
  useSubmit,
} from "../auth-kit"
import { go, replace } from "../navigation"
import {
  AuthError,
  checkUsername,
  chooseUsername,
  continueWith,
  emailError,
  handOffEmail,
  nameError,
  passwordStrength,
  sessionStore,
  signUp,
  usernameError,
} from "../session"
import { fonts, useTheme } from "../theme"

type Availability = "idle" | "checking" | "available" | "taken"
type Key = "name" | "username" | "email" | "password" | "terms"

/** Debounced "is this handle free?" lookup (the server's in live mode). A
 * check that could not be answered stays neutral, never "available". */
function useAvailability(username: string) {
  const [state, setState] = useState<Availability>("idle")
  useEffect(() => {
    if (usernameError(username)) {
      setState("idle")
      return
    }
    let live = true
    setState("checking")
    const id = setTimeout(async () => {
      const result = await checkUsername(username)
      if (live) setState(result === "unknown" ? "idle" : result)
    }, 350)
    return () => {
      live = false
      clearTimeout(id)
    }
  }, [username])
  return state
}

const statusOf = (availability: Availability) =>
  availability === "checking"
    ? "checking"
    : availability === "available"
      ? "ok"
      : availability === "taken"
        ? "bad"
        : "idle"

export function SignUp() {
  const claim = sessionStore.use((s) => s.claim)
  return claim ? <ChooseUsername refused={claim.username} /> : <NewAccount />
}

/** The account is verified but the server refused its username (claimed by
 * someone else meanwhile): ask for another before letting the person in. */
function ChooseUsername({ refused }: { refused: string }) {
  const t = useTheme()
  const [username, setUsername] = useState(refused)
  const [refusedNow, setRefusedNow] = useState(refused)
  const availability = useAvailability(username)
  const submit = useSubmit()
  const taken = availability === "taken" || username === refusedNow
  const error =
    usernameError(username) ??
    (taken ? `@${username} is already taken` : undefined)

  const onSubmit = async () => {
    if (error) {
      haptic.error()
      return
    }
    const ok = await submit.run(
      () => chooseUsername(username),
      (e) => {
        if (e instanceof AuthError && e.field === "username")
          setRefusedNow(username)
      },
    )
    if (ok) {
      haptic.success()
      replace("/onboarding")
    }
  }

  return (
    <AuthScreen
      showBack={false}
      title="Choose another username"
      subtitle="Your email is verified. Someone took your username while you were confirming it, so pick another to finish."
    >
      {submit.error && username !== refusedNow && (
        <ErrorBanner message={submit.error} shakeKey={submit.shakeKey} />
      )}
      <Rise i={1}>
        <AuthField
          label="Username"
          icon={AtSign}
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s/g, ""))}
          error={error}
          hint={
            availability === "available" && !error ? (
              <Text
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 13,
                  color: t.good,
                }}
              >
                @{username} is available
              </Text>
            ) : undefined
          }
          right={<FieldStatus status={statusOf(availability)} />}
          placeholder="kai.sop"
          textContentType="nickname"
          autoComplete="username-new"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onSubmit}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={2}>
        <AuthButton
          onPress={onSubmit}
          loading={submit.busy}
          loadingLabel="Saving…"
        >
          Continue
        </AuthButton>
      </Rise>
    </AuthScreen>
  )
}

function NewAccount() {
  const t = useTheme()
  const [name, setName] = useState("")
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [terms, setTerms] = useState(false)
  const [touched, setTouched] = useState<Record<Key, boolean>>({
    name: false,
    username: false,
    email: false,
    password: false,
    terms: false,
  })
  const [passwordFocused, setPasswordFocused] = useState(false)
  const [social, setSocial] = useState<"apple" | "google" | null>(null)
  const [emailTaken, setEmailTaken] = useState(false)
  const refs = {
    name: useRef<TextInputInstance>(null),
    username: useRef<TextInputInstance>(null),
    email: useRef<TextInputInstance>(null),
    password: useRef<TextInputInstance>(null),
  }
  const availability = useAvailability(username)
  const submit = useSubmit()
  const strength = passwordStrength(password)

  const errors: Record<Key, string | undefined> = {
    name: nameError(name),
    username:
      usernameError(username) ??
      (availability === "taken" ? `@${username} is already taken` : undefined),
    email: emailError(email),
    password: !password
      ? "Create a password"
      : strength.acceptable
        ? undefined
        : "Use 8+ characters with at least 3 of the items below",
    terms: terms ? undefined : "Please accept the terms to continue",
  }
  const blur = (key: Key, filled: boolean) =>
    setTouched((s) => ({ ...s, [key]: filled || s[key] }))
  const show = (key: Key) => (touched[key] ? errors[key] : undefined)

  const onSubmit = async () => {
    setTouched({
      name: true,
      username: true,
      email: true,
      password: true,
      terms: true,
    })
    const first = (["name", "username", "email", "password"] as const).find(
      (k) => errors[k],
    )
    if (first || errors.terms) {
      haptic.error()
      if (first) refs[first].current?.focus()
      return
    }
    const ok = await submit.run(
      () => signUp({ name, username, email, password }),
      (e) => {
        if (e instanceof AuthError && e.field === "email") {
          setEmailTaken(true)
          refs.email.current?.focus()
        }
      },
    )
    if (ok) {
      haptic.success()
      if (sessionStore.get().signedIn) replace("/onboarding")
      else go("/verify-email")
    }
  }
  const onSocial = async (provider: "apple" | "google") => {
    setSocial(provider)
    try {
      await continueWith(provider)
      haptic.success()
      replace("/onboarding")
    } catch {
      setSocial(null)
      toast.error("Could not sign up. Please try again.")
    }
  }
  const usernameHint =
    availability === "available" && !errors.username ? (
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: t.good }}>
        @{username} is available
      </Text>
    ) : (
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: t.muted }}>
        Friends find you by this. Lowercase letters, numbers, . and _
      </Text>
    )

  return (
    <AuthScreen
      title="Create your account"
      subtitle={
        liveMode
          ? "One minute to set up. Your data syncs to your account."
          : "One minute to set up. Everything stays on this device."
      }
      footer={
        <SwitchPrompt
          question="Already have an account?"
          action="Sign in"
          onPress={() => replace("/login")}
        />
      }
    >
      {submit.error && !emailTaken && (
        <ErrorBanner message={submit.error} shakeKey={submit.shakeKey} />
      )}
      <Rise i={1}>
        <AuthField
          ref={refs.name}
          label="Name"
          icon={User}
          value={name}
          onChangeText={setName}
          onBlur={() => blur("name", !!name)}
          error={show("name")}
          placeholder="Your name"
          textContentType="name"
          autoComplete="name"
          autoCapitalize="words"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => refs.username.current?.focus()}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={2}>
        <AuthField
          ref={refs.username}
          label="Username"
          icon={AtSign}
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/\s/g, ""))}
          onBlur={() => blur("username", !!username)}
          error={availability === "taken" ? errors.username : show("username")}
          hint={usernameHint}
          right={<FieldStatus status={statusOf(availability)} />}
          placeholder="kai.sop"
          textContentType="nickname"
          autoComplete="username-new"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => refs.email.current?.focus()}
          editable={!submit.busy}
        />
      </Rise>
      <Rise i={3}>
        <AuthField
          ref={refs.email}
          label="Email"
          icon={Mail}
          value={email}
          onChangeText={(v) => {
            setEmail(v)
            if (emailTaken) {
              setEmailTaken(false)
              submit.clear()
            }
          }}
          onBlur={() => blur("email", !!email)}
          error={
            emailTaken ? "This email already has an account" : show("email")
          }
          placeholder="name@example.com"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => refs.password.current?.focus()}
          editable={!submit.busy}
        />
        {emailTaken && (
          <View style={{ marginTop: -12, marginBottom: 6 }}>
            <TextLink
              align="flex-start"
              onPress={() => {
                handOffEmail(email)
                replace("/login")
              }}
            >
              Sign in with this email instead
            </TextLink>
          </View>
        )}
      </Rise>
      <Rise i={4}>
        <PasswordField
          ref={refs.password}
          label="Password"
          icon={LockKeyhole}
          value={password}
          onChangeText={setPassword}
          onFocus={() => setPasswordFocused(true)}
          onBlur={() => {
            setPasswordFocused(false)
            blur("password", !!password)
          }}
          error={show("password")}
          placeholder="Create a password"
          textContentType="newPassword"
          autoComplete="new-password"
          passwordRules="minlength: 8; required: lower; required: upper; required: digit;"
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={onSubmit}
          editable={!submit.busy}
        />
        <StrengthMeter
          password={password}
          showRules={passwordFocused || !!password || touched.password}
        />
      </Rise>
      <Rise i={5}>
        <View style={{ marginBottom: 16 }}>
          <Checkbox
            label="I agree to the Terms of Service and Privacy Policy"
            checked={terms}
            onChange={setTerms}
            error={!!show("terms")}
          >
            <Text
              style={{
                flexShrink: 1,
                fontFamily: fonts.body,
                fontSize: 15,
                lineHeight: 21,
                color: t.text,
              }}
            >
              I agree to the{" "}
              <Text
                accessibilityRole="link"
                onPress={() =>
                  toast("Terms of Service", {
                    description: "Placeholder in the prototype.",
                  })
                }
                style={{ fontFamily: fonts.medium, color: t.primary }}
              >
                Terms of Service
              </Text>{" "}
              and{" "}
              <Text
                accessibilityRole="link"
                onPress={() =>
                  toast("Privacy Policy", {
                    description: "Placeholder in the prototype.",
                  })
                }
                style={{ fontFamily: fonts.medium, color: t.primary }}
              >
                Privacy Policy
              </Text>
            </Text>
          </Checkbox>
          {show("terms") && (
            <Text
              accessibilityRole="alert"
              style={{
                fontFamily: fonts.medium,
                fontSize: 13,
                color: t.bad,
                marginLeft: 32,
              }}
            >
              {errors.terms}
            </Text>
          )}
        </View>
      </Rise>
      <Rise i={6}>
        <AuthButton
          onPress={onSubmit}
          loading={submit.busy}
          loadingLabel="Creating account…"
          disabled={!!social}
        >
          Create account
        </AuthButton>
      </Rise>
      <Rise i={7}>
        <OrDivider label="or sign up with" />
        <SocialButtons
          busy={social}
          onPress={onSocial}
          disabled={submit.busy}
        />
        <DemoTip>
          “taken@example.com” is already registered, and @kai or @admin are
          taken usernames.
        </DemoTip>
      </Rise>
    </AuthScreen>
  )
}
