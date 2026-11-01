// Account & security: the sign-in side of the account — email, password,
// sessions, a copy of your data, and deleting the account. Every action ends
// in a toast that says what happened.
import {
  Download,
  KeyRound,
  LogOut,
  Mail,
  MonitorSmartphone,
  Trash2,
  UserRound,
} from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { toast } from "sonner-native"
import { liveMode } from "@/live/config"
import { PasswordField, StrengthMeter } from "../auth-kit"
import { exportJson } from "../media"
import { Copy, Frame, Line, LinkRow, SectionHeading, Tap } from "../native-kit"
import { replace } from "../navigation"
import {
  AuthError,
  changeEmail,
  changePassword,
  DELETE_WORD,
  deleteAccount,
  exportData,
  newPasswordErrors,
  sessionStore,
  signOutEverywhere,
} from "../session"
import { confirmSignOut } from "../sign-out-flow"
import { useTheme } from "../theme"
import { Button, confirm, Field, Screen, Sheet } from "../ui"

type Open = "email" | "password" | "delete" | null

export function Account() {
  const t = useTheme()
  const user = sessionStore.use((s) => s.user)
  const [open, setOpen] = useState<Open>(null)
  const close = () => setOpen(null)
  const exportMine = async () => {
    const day = new Date().toISOString().slice(0, 10)
    const ok = await exportJson(`personal-sop-${day}.json`, exportData())
    if (!ok) toast.error("Export failed. Please try again.")
  }
  return (
    <Screen title="Account & security">
      <SectionHeading>Sign-in</SectionHeading>
      <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
        <LinkRow
          title="Email"
          detail={user?.email || "Not set"}
          icon={Mail}
          onPress={() => setOpen("email")}
          right={
            <Copy size={14} weight="medium" style={{ color: t.primary }}>
              Change
            </Copy>
          }
        />
        <LinkRow
          title="Change password"
          icon={KeyRound}
          onPress={() => setOpen("password")}
        />
        <LinkRow
          title="Edit profile"
          detail="Name, username and photo"
          icon={UserRound}
          href="/me/profile"
        />
      </Frame>
      <SectionHeading>Sessions</SectionHeading>
      <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
        <LinkRow
          title="Sign out"
          detail="This device only"
          icon={LogOut}
          onPress={confirmSignOut}
        />
        <LinkRow
          title="Sign out everywhere"
          detail="Ends every session, on all your devices"
          icon={MonitorSmartphone}
          onPress={() =>
            confirm(
              "Sign out everywhere?",
              "Every phone and browser signed in to this account is signed out, including this one. Edits not yet synced on this device are lost.",
              () => {
                signOutEverywhere().then(
                  () => replace("/welcome"),
                  (e: unknown) =>
                    toast.error(
                      e instanceof AuthError
                        ? e.message
                        : "Couldn't sign out everywhere. Try again.",
                    ),
                )
              },
            )
          }
        />
      </Frame>
      <SectionHeading>Your data</SectionHeading>
      <Frame style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
        <LinkRow
          title="Export my data"
          detail="Everything you've logged, as a JSON file"
          icon={Download}
          onPress={() => void exportMine()}
        />
      </Frame>
      <SectionHeading>Danger zone</SectionHeading>
      <Frame
        style={{
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderColor: `${t.bad}55`,
        }}
      >
        <Tap
          label="Delete account"
          onPress={() => setOpen("delete")}
          style={{ paddingHorizontal: 8, paddingVertical: 12 }}
        >
          <Line>
            <View
              style={{
                height: 36,
                width: 36,
                borderRadius: 12,
                backgroundColor: `${t.bad}26`,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Trash2 size={16} color={t.bad} />
            </View>
            <View style={{ flex: 1 }}>
              <Copy weight="medium" style={{ color: t.bad }}>
                Delete account
              </Copy>
              <Copy size={12} muted>
                Permanently removes your account and everything in it
              </Copy>
            </View>
          </Line>
        </Tap>
      </Frame>
      {open === "email" && (
        <EmailSheet current={user?.email ?? ""} onClose={close} />
      )}
      {open === "password" && <PasswordSheet onClose={close} />}
      {open === "delete" && <DeleteSheet onClose={close} />}
    </Screen>
  )
}

/** Splits an action's failure into a field error or a toast. */
function report(
  error: unknown,
  onField: (field: string, message: string) => void,
) {
  if (error instanceof AuthError && error.field)
    onField(error.field, error.message)
  else
    toast.error(
      error instanceof AuthError
        ? error.message
        : "Something went wrong. Try again.",
    )
}

function EmailSheet({
  current,
  onClose,
}: {
  current: string
  onClose: () => void
}) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await changeEmail(email)
      onClose()
    } catch (e) {
      report(e, (_, message) => setError(message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Change email" open onClose={onClose}>
      <Copy size={14} muted>
        {current ? `Now: ${current}. ` : ""}
        {liveMode
          ? "We'll send a link to the new address. The change applies once you open it."
          : "Sign in with the new address from now on."}
      </Copy>
      <Field
        label="New email"
        value={email}
        onChangeText={setEmail}
        error={error}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
        placeholder="name@example.com"
      />
      <Button disabled={busy || !email.trim()} onPress={() => void save()}>
        {busy ? "Sending…" : liveMode ? "Send confirmation link" : "Save email"}
      </Button>
    </Sheet>
  )
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [tried, setTried] = useState(false)
  const [serverError, setServerError] = useState<{
    current?: string
    next?: string
  }>({})
  const [busy, setBusy] = useState(false)
  const errors = tried ? newPasswordErrors(current, next, again) : {}
  const save = async () => {
    setTried(true)
    setServerError({})
    if (Object.keys(newPasswordErrors(current, next, again)).length) return
    setBusy(true)
    try {
      await changePassword(current, next)
      onClose()
    } catch (e) {
      report(e, (_, message) =>
        // GoTrue says "password" for both: a wrong current password is the
        // re-sign-in failing, a refused new one is about the new password.
        setServerError(
          message.toLowerCase().includes("incorrect")
            ? { current: message }
            : { next: message },
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Change password" open onClose={onClose}>
      <PasswordField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        error={serverError.current ?? errors.current}
        autoComplete="current-password"
        textContentType="password"
      />
      <PasswordField
        label="New password"
        value={next}
        onChangeText={setNext}
        error={serverError.next ?? errors.next}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <StrengthMeter password={next} />
      <PasswordField
        label="Confirm new password"
        value={again}
        onChangeText={setAgain}
        error={errors.confirm}
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <Button disabled={busy} onPress={() => void save()}>
        {busy ? "Saving…" : "Change password"}
      </Button>
    </Sheet>
  )
}

function DeleteSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const [password, setPassword] = useState("")
  const [typed, setTyped] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const armed = typed.trim() === DELETE_WORD && !!password && !busy
  const remove = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await deleteAccount(password)
      onClose()
      replace("/welcome")
    } catch (e) {
      report(e, (_, message) => setError(message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet title="Delete account" open onClose={onClose}>
      <View
        style={{
          gap: 6,
          padding: 12,
          borderRadius: 12,
          backgroundColor: `${t.bad}14`,
        }}
      >
        <Copy size={14} weight="semibold" style={{ color: t.bad }}>
          This can't be undone.
        </Copy>
        <Copy size={14}>
          Your sign-in, profile, habits, tasks, workouts, meals, money records,
          journal, chats with Fern and social posts are all permanently deleted,
          on every device.
        </Copy>
        <Copy size={12} muted>
          Want a copy first? Use Export my data before you delete.
        </Copy>
      </View>
      <PasswordField
        label="Your password"
        value={password}
        onChangeText={setPassword}
        error={error}
        autoComplete="current-password"
        textContentType="password"
      />
      <Field
        label={`Type ${DELETE_WORD} to confirm`}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder={DELETE_WORD}
      />
      <Button tone="danger" disabled={!armed} onPress={() => void remove()}>
        {busy ? "Deleting…" : "Delete my account"}
      </Button>
    </Sheet>
  )
}
