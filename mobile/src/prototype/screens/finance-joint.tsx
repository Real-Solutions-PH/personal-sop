// Joint accounts in Finance: the owner's "Shared with" panel on their own
// account (add a friend, invite with a link, pending links, remove people),
// a member's view of an account someone else owns (balance, every
// transaction and who logged it, add one, leave), and the screen an invite
// link opens. A member's view reads the synced store (offline too); sharing,
// links and accepting a link are online calls (live/joint-accounts.ts).
import * as J from "@domain/finance/joint"
import { sharedStore } from "@domain/finance/loans"
import { finStore } from "@domain/finance/store"
import { dayKey } from "@domain/lib/day"
import { getConnectivity } from "@domain/lib/platform"
import * as Clipboard from "expo-clipboard"
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy as CopyIcon,
  Link2,
  LinkIcon,
  LogOut,
  Plus,
  Share2,
  ShieldX,
  TimerOff,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react-native"
import { useCallback, useEffect, useRef, useState } from "react"
import { Share, View } from "react-native"
import { liveMode } from "@/live/config"
import { BigMoment, useMomentTimer } from "../big-moment"
import { FrameSkeleton } from "../deferred"
import { MoneyInput } from "../money-input"
import {
  Copy,
  Frame,
  IconTap,
  Line,
  SectionHeading,
  SmallButton,
  Tap,
} from "../native-kit"
import { go, replace } from "../navigation"
import { useTheme } from "../theme"
import {
  Button,
  Choices,
  confirm,
  DateField,
  Empty,
  Field,
  Screen,
  Sheet,
} from "../ui"
import { AccountCard } from "./finance-account-card"
import { toCentavos } from "./finance-loan-sheets"
import { FinPill } from "./finance-planned"
import { useLoanMoney } from "./finance-shared"
import { PeoplePicker } from "./finance-shared-groups"
import { Dimmed, EmptyFoot } from "./locked-preview"

const live = () =>
  require("@/live/joint-accounts") as typeof import("@/live/joint-accounts")

/** This person's user id (the server's), or "me" off line-of-sync builds. */
export function myId(): string {
  if (!liveMode) return "me"
  return (
    (
      require("@/live/runtime") as typeof import("@/live/runtime")
    ).liveOwner() ?? "me"
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?"

/** Overlapping initials of the people in a joint account. */
export function Faces({
  people,
  size = 24,
  max = 4,
  onCard = false,
}: {
  people: { id: string; name: string }[]
  size?: number
  max?: number
  onCard?: boolean
}) {
  const t = useTheme()
  const shown = people.slice(0, max)
  const more = people.length - shown.length
  return (
    <View
      accessibilityLabel={`Shared with ${people.map((p) => p.name).join(", ")}`}
      style={{ flexDirection: "row", alignItems: "center" }}
    >
      {shown.map((p, i) => (
        <View
          key={p.id}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i ? -size / 4 : 0,
            borderWidth: 2,
            borderColor: onCard ? "rgba(255,255,255,0.9)" : t.card,
            backgroundColor: onCard ? "rgba(0,0,0,0.28)" : t.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Copy
            size={size * 0.38}
            weight="semibold"
            style={{ color: onCard ? "white" : t.text }}
          >
            {initials(p.name)}
          </Copy>
        </View>
      ))}
      {more > 0 && (
        <Copy
          size={12}
          style={{ marginLeft: 4, color: onCard ? "white" : t.muted }}
        >
          +{more}
        </Copy>
      )}
    </View>
  )
}

/** The mark an account card carries when it is joint. */
export function JointMark({ joint }: { joint: J.SharedAccount }) {
  const people = J.activeMembers(joint).map((m) => m.person)
  return (
    <View style={{ alignItems: "flex-end", gap: 2 }}>
      <Line style={{ gap: 4 }}>
        <Users size={12} color="white" />
        <Copy size={12} weight="medium" style={{ color: "white" }}>
          Shared
        </Copy>
      </Line>
      <Faces people={people} size={22} onCard />
    </View>
  )
}

export const useJointAccounts = () =>
  sharedStore.use((s) => s.accounts ?? J.NO_ACCOUNTS)

/** My view of a joint account, if it is one (owner or member). */
export function useJoint(accountId: string | undefined) {
  const list = useJointAccounts()
  return accountId ? list.find((a) => a.accountId === accountId) : undefined
}

/** The owner's own account is joint once someone else is in it or invited. */
export const isJoint = (j: J.SharedAccount | undefined) =>
  !!j &&
  j.members.some(
    (m) =>
      m.role === "member" && (m.status === "active" || m.status === "invited"),
  )

/** A joint account someone else owns, drawn like my own accounts. */
export function JointAccountCard({ joint }: { joint: J.SharedAccount }) {
  return (
    <AccountCard
      account={{
        id: joint.accountId,
        name: joint.name,
        type: (["cash", "bank", "ewallet", "credit", "investment"].includes(
          joint.type,
        )
          ? joint.type
          : "bank") as never,
        opening: 0,
        openingDate: joint.sharedAt.slice(0, 10),
        color: joint.color,
        inNetWorth: joint.inNetWorth,
        inProjection: false,
        archived: joint.archived,
        manual: true,
        order: 0,
      }}
      balance={joint.balance / 100}
      onPress={() => go(`/finance/shared/account/${joint.accountId}`)}
      shared={<JointMark joint={joint} />}
    />
  )
}

// ---------------------------------------------------------------- owner's panel

const SAMPLE_MEMBERS: J.JointMember[] = [
  { person: { id: "me", name: "You" }, role: "owner", status: "active" },
  {
    person: { id: "them", name: "Your partner" },
    role: "member",
    status: "active",
  },
]

function MemberRow({
  m,
  onRemove,
}: {
  m: J.JointMember
  onRemove?: () => void
}) {
  return (
    <Line style={{ paddingVertical: 10, gap: 10 }}>
      <Faces people={[m.person]} size={32} />
      <View style={{ flex: 1 }}>
        <Copy weight="medium">{m.person.name}</Copy>
        <Copy size={12} muted>
          {m.role === "owner"
            ? "Owner"
            : m.status === "invited"
              ? "Invited, hasn't answered yet"
              : "Member"}
        </Copy>
      </View>
      {m.status === "invited" && <FinPill tone="warn">Invited</FinPill>}
      {onRemove && (
        <IconTap
          icon={UserMinus}
          label={`Remove ${m.person.name}`}
          onPress={onRemove}
        />
      )}
    </Line>
  )
}

const until = (iso: string) => {
  const days = Math.max(
    0,
    Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000),
  )
  return days <= 1 ? "Expires within a day" : `Expires in ${days} days`
}

/** "Shared with" on the owner's own account: members, invites, links. */
export function ShareSection({
  accountId,
  name,
}: {
  accountId: string
  name: string
}) {
  const t = useTheme(),
    synced = useJoint(accountId),
    [view, setView] = useState<J.SharedAccount | null | undefined>(undefined),
    [failed, setFailed] = useState(false),
    [links, setLinks] = useState<
      import("@/live/joint-accounts").InviteLink[] | null
    >(null),
    [picking, setPicking] = useState(false),
    [who, setWho] = useState<string[]>([]),
    [link, setLink] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const load = useCallback(() => {
    if (!liveMode || !getConnectivity()) {
      setFailed(true)
      return
    }
    setFailed(false)
    Promise.all([
      live().fetchAccount(accountId),
      live().pendingLinks(accountId),
    ])
      .then(([v, l]) => {
        setView(v)
        setLinks(l)
      })
      .catch(() => setFailed(true))
  }, [accountId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the synced view changes
  useEffect(() => load(), [load, synced?.members.length])
  if (!liveMode) return null
  const members = (view ?? synced)?.members ?? []
  const others = members.filter((m) => m.role === "member")
  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNote(null)
    try {
      await what()
      setNote({ ok: true, text: done })
      load()
    } catch {
      setNote({
        ok: false,
        text: getConnectivity()
          ? "That didn't go through. Try again."
          : "You're offline. Sharing needs a connection.",
      })
    } finally {
      setBusy(false)
    }
  }
  const makeLink = () =>
    run(async () => {
      const l = await live().createLink(accountId)
      setLink(l.url)
    }, "Link ready. It works once, for 7 days.")
  return (
    <View style={{ marginTop: -12 }} testID="joint-share-section">
      <SectionHeading icon={Users}>Shared with</SectionHeading>
      <Frame style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        {view === undefined && !failed ? (
          <FrameSkeleton height={72} />
        ) : failed && view === undefined ? (
          <View style={{ paddingVertical: 8, gap: 8 }}>
            <Copy size={14} style={{ color: t.bad }}>
              Couldn't load who this is shared with.
            </Copy>
            <SmallButton icon={Clock} onPress={load}>
              Try again
            </SmallButton>
          </View>
        ) : others.length ? (
          members.map((m) => (
            <MemberRow
              key={m.person.id}
              m={m}
              onRemove={
                m.role === "member"
                  ? () =>
                      confirm(
                        `Remove ${m.person.name}?`,
                        `${m.person.name} stops seeing ${name} and can't add to it. Transactions they logged stay.`,
                        () =>
                          run(
                            () => live().removeMember(accountId, m.person.id),
                            `${m.person.name} was removed`,
                          ),
                        "Remove",
                      )
                  : undefined
              }
            />
          ))
        ) : (
          <View testID="joint-share-empty">
            <Dimmed>
              {SAMPLE_MEMBERS.map((m) => (
                <MemberRow key={m.person.id} m={m} />
              ))}
            </Dimmed>
            <EmptyFoot hint="Share this account to run it together: everyone sees the balance and every transaction, and can add their own." />
          </View>
        )}
        <Line style={{ gap: 8, paddingVertical: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              small
              icon={UserPlus}
              disabled={busy}
              onPress={() => {
                setWho([])
                setPicking(true)
              }}
            >
              Add a friend
            </Button>
          </View>
          <View style={{ flex: 1 }}>
            <Button
              small
              tone="quiet"
              icon={Link2}
              disabled={busy}
              onPress={makeLink}
            >
              Invite with a link
            </Button>
          </View>
        </Line>
        {link && (
          <View
            testID="joint-invite-link"
            style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: t.soft,
              gap: 8,
              marginBottom: 8,
            }}
          >
            <Copy size={12} style={{ color: t.text }}>
              {link}
            </Copy>
            <Line style={{ gap: 8 }}>
              <SmallButton
                icon={CopyIcon}
                onPress={() => {
                  void Clipboard.setStringAsync(link)
                  setNote({ ok: true, text: "Link copied" })
                }}
              >
                Copy link
              </SmallButton>
              <SmallButton
                quiet
                icon={Share2}
                onPress={() =>
                  void Share.share({
                    message: `Join my joint account "${name}" on Unfurl: ${link}`,
                  }).catch(() => {})
                }
              >
                Share
              </SmallButton>
            </Line>
          </View>
        )}
        {note && (
          <Line style={{ gap: 6, paddingBottom: 8 }}>
            {note.ok ? (
              <Check size={14} color={t.good} />
            ) : (
              <X size={14} color={t.bad} />
            )}
            <Copy
              size={13}
              style={{ color: note.ok ? t.good : t.bad, flex: 1 }}
            >
              {note.text}
            </Copy>
          </Line>
        )}
        {!!links?.length && (
          <View style={{ paddingBottom: 8 }}>
            <Copy size={12} muted style={{ marginBottom: 4 }}>
              Links waiting to be used
            </Copy>
            {links.map((l) => (
              <Line key={l.id} style={{ paddingVertical: 6, gap: 8 }}>
                <LinkIcon size={16} color={t.muted} />
                <Copy size={13} style={{ flex: 1 }}>
                  {until(l.expiresAt)}
                </Copy>
                <IconTap
                  icon={X}
                  label="Cancel this link"
                  onPress={() =>
                    run(() => live().revokeLink(l.id), "Link cancelled")
                  }
                />
              </Line>
            ))}
          </View>
        )}
      </Frame>
      <Sheet
        title={`Share ${name}`}
        open={picking}
        onClose={() => setPicking(false)}
      >
        <Copy size={13} muted>
          They'll get an invite to accept. Once in, they see the balance and
          every transaction and can add their own. Only you rename, archive or
          remove people.
        </Copy>
        <PeoplePicker open={picking} picked={who} onChange={setWho} />
        <Button
          icon={UserPlus}
          disabled={!who.length || busy}
          onPress={() => {
            setPicking(false)
            const names = who.length === 1 ? "1 person" : `${who.length} people`
            void run(
              () => live().shareAccount(accountId, who),
              `Invited ${names}. They'll see it once they accept.`,
            )
          }}
        >
          {who.length ? `Invite ${who.length}` : "Pick who to invite"}
        </Button>
      </Sheet>
    </View>
  )
}

// ---------------------------------------------------------------- member's view

function RecordRow({
  r,
  joint,
  money,
}: {
  r: J.JointRecord
  joint: J.SharedAccount
  money: (minor: number, code: string) => string
}) {
  const t = useTheme()
  const by =
    joint.members.find((m) => m.person.id === r.byId)?.person ??
    (r.byId === joint.owner.id ? joint.owner : { id: r.byId, name: "Someone" })
  const In = r.signed >= 0
  return (
    <Line style={{ paddingVertical: 10, gap: 10 }} testID="joint-record">
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: t.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {In ? (
          <ArrowDownLeft size={16} color={t.good} />
        ) : (
          <ArrowUpRight size={16} color={t.text} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Copy weight="medium">
          {r.payee || r.categoryName || (In ? "Money in" : "Money out")}
        </Copy>
        <Line style={{ gap: 6 }}>
          <Faces people={[by]} size={16} />
          <Copy size={12} muted style={{ flex: 1 }}>
            {by.name}
            {r.categoryName && r.payee ? ` · ${r.categoryName}` : ""}
            {" · "}
            {r.local ? "Saving…" : r.day}
          </Copy>
        </Line>
      </View>
      <Copy
        weight="semibold"
        style={{ color: In ? t.good : t.text, flexShrink: 0 }}
      >
        {In ? "+" : "−"}
        {money(Math.abs(r.signed), joint.currency)}
      </Copy>
    </Line>
  )
}

function AddRecordSheet({
  joint,
  open,
  onClose,
}: {
  joint: J.SharedAccount
  open: boolean
  onClose: () => void
}) {
  const t = useTheme(),
    [type, setType] = useState<"expense" | "income">("expense"),
    [amount, setAmount] = useState(""),
    [payee, setPayee] = useState(""),
    [cat, setCat] = useState<string | undefined>(undefined),
    [day, setDay] = useState(dayKey()),
    [error, setError] = useState("")
  const cats = joint.categories.filter((c) => c.kind === type && !c.parentId)
  const save = () => {
    const minor = toCentavos(Number(amount))
    if (!Number.isFinite(minor) || minor <= 0)
      return setError("Enter an amount above zero")
    J.addJointRecord(joint.accountId, {
      type,
      amount: minor,
      day,
      categoryId: cat,
      payee,
      me: myId(),
    })
    setAmount("")
    setPayee("")
    setCat(undefined)
    setError("")
    onClose()
  }
  return (
    <Sheet title={`Add to ${joint.name}`} open={open} onClose={onClose}>
      <Choices
        value={type}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Money in" },
        ]}
        onChange={(v) => {
          setType(v)
          setCat(undefined)
        }}
      />
      <MoneyInput
        label={`Amount (${joint.currency})`}
        value={amount}
        onChange={setAmount}
        error={error || undefined}
      />
      <Field
        label="What for"
        placeholder={type === "expense" ? "Groceries" : "Salary share"}
        value={payee}
        onChangeText={setPayee}
        maxLength={120}
      />
      {cats.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {cats.map((c) => {
            const on = cat === c.id
            return (
              <Tap
                key={c.id}
                label={`${on ? "Unpick" : "Pick"} ${c.name}`}
                onPress={() => setCat(on ? undefined : c.id)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: on ? t.fin : t.line,
                  backgroundColor: on ? `${t.fin}14` : t.card,
                }}
              >
                <Copy size={13}>{c.name}</Copy>
              </Tap>
            )
          })}
        </View>
      )}
      <DateField
        label="Date"
        value={day}
        onChangeText={setDay}
        maximumDate={dayKey()}
      />
      <Button icon={Check} onPress={save}>
        {type === "expense" ? "Add expense" : "Add money in"}
      </Button>
    </Sheet>
  )
}

const JOINING_POINTS = [
  "See its balance and every transaction, and who logged it",
  "Add transactions to it",
  "Its balance counts in your net worth",
  "The owner keeps it: only they rename, archive or remove people. You can leave any time",
]

function Points({ points }: { points: string[] }) {
  const t = useTheme()
  return (
    <View style={{ gap: 8 }}>
      {points.map((p) => (
        <Line key={p} style={{ gap: 8, alignItems: "flex-start" }}>
          <Check size={16} color={t.good} style={{ marginTop: 2 }} />
          <Copy size={14} style={{ flex: 1 }}>
            {p}
          </Copy>
        </Line>
      ))}
    </View>
  )
}

function JoinedMoment({
  name,
  owner,
  onClose,
}: {
  name: string
  owner: string
  onClose: () => void
}) {
  const t = useTheme()
  return (
    <BigMoment
      testID="joint-joined-moment"
      label="You're in"
      title={name}
      detail={
        <Copy size={14} muted style={{ textAlign: "center" }}>
          You and {owner} now run this account together.
        </Copy>
      }
      badge={<UserCheck size={34} color="#fff" />}
      tint={t.fin}
      say={`You joined ${name} with ${owner}.`}
      onClose={onClose}
    />
  )
}

/** A joint account as a member sees it: /finance/shared/account/[id]. */
export function JointAccountDetail({ accountId }: { accountId: string }) {
  const t = useTheme(),
    m = useLoanMoney(),
    synced = useJoint(accountId),
    mine = finStore.use((s) => s.accounts.some((a) => a.id === accountId)),
    [fetched, setFetched] = useState<J.SharedAccount | null | undefined>(
      undefined,
    ),
    [adding, setAdding] = useState(false),
    [older, setOlder] = useState<J.JointRecord[]>([]),
    [olderBusy, setOlderBusy] = useState(false),
    [olderFailed, setOlderFailed] = useState(false),
    [joined, setJoined] = useState(false),
    [moment, closeMoment] = useMomentTimer(joined)
  // The owner manages it on their own account's screen.
  useEffect(() => {
    if (mine) replace(`/finance/accounts/${accountId}`)
  }, [mine, accountId])
  // Not synced yet (a link accepted a moment ago): ask the server.
  useEffect(() => {
    if (synced || !liveMode || !getConnectivity()) {
      if (!synced) setFetched(null)
      return
    }
    let gone = false
    live()
      .fetchAccount(accountId)
      .then((v) => !gone && setFetched(v))
      .catch(() => !gone && setFetched(null))
    return () => {
      gone = true
    }
  }, [synced, accountId])
  const joint = synced ?? fetched ?? undefined
  if (mine)
    return (
      <Screen prototypeLayout title="Account">
        <FrameSkeleton height={120} />
      </Screen>
    )
  if (!joint)
    return (
      <Screen prototypeLayout title="Joint account">
        {fetched === undefined && !synced ? (
          <FrameSkeleton height={160} />
        ) : (
          <Empty
            icon={ShieldX}
            title="This joint account isn't available"
            detail="You may have left it, or the owner removed you or stopped sharing it."
            action={
              <Button tone="quiet" href="/finance/accounts">
                Go to accounts
              </Button>
            }
          />
        )}
      </Screen>
    )
  const others = J.activeMembers(joint).map((x) => x.person)
  const records = [...joint.records, ...older]
  return (
    <Screen
      prototypeLayout
      title={joint.name}
      actions={
        joint.myStatus === "active" ? (
          <IconTap
            size={40}
            icon={Plus}
            label="Add a transaction"
            color={t.text}
            onPress={() => setAdding(true)}
          />
        ) : undefined
      }
    >
      {moment && (
        <JoinedMoment
          name={joint.name}
          owner={joint.owner.name}
          onClose={closeMoment}
        />
      )}
      {joint.myStatus === "invited" ? (
        <Frame style={{ padding: 16, gap: 12 }} testID="joint-invite-card">
          <Line style={{ gap: 10 }}>
            <Faces people={[joint.owner]} size={40} />
            <View style={{ flex: 1 }}>
              <Copy size={12} muted>
                Joint account · from {joint.owner.name}
              </Copy>
              <Copy size={20} weight="semibold">
                {joint.name}
              </Copy>
            </View>
          </Line>
          <Points points={JOINING_POINTS} />
          <Line style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                icon={Check}
                onPress={() => {
                  J.respondAccount(joint.accountId, true)
                  setJoined(true)
                }}
              >
                Join
              </Button>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                tone="quiet"
                icon={X}
                onPress={() =>
                  confirm(
                    `Decline ${joint.name}?`,
                    `${joint.owner.name} will see you declined. They can invite you again.`,
                    () => {
                      J.respondAccount(joint.accountId, false)
                      go("/finance/shared")
                    },
                    "Decline",
                  )
                }
              >
                Decline
              </Button>
            </View>
          </Line>
        </Frame>
      ) : (
        <>
          <AccountCardForJoint joint={joint} />
          <Frame style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <Line style={{ paddingVertical: 8, gap: 10 }}>
              <Faces people={others} size={28} max={6} />
              <Copy size={13} muted style={{ flex: 1 }}>
                {joint.owner.name} owns it · {others.length}{" "}
                {others.length === 1 ? "person" : "people"} in it
              </Copy>
            </Line>
          </Frame>
          <View style={{ marginTop: -12 }}>
            <SectionHeading
              action={
                <Copy size={12} muted>
                  {joint.recordsTotal} in all
                </Copy>
              }
            >
              Transactions
            </SectionHeading>
            <Frame style={{ paddingHorizontal: 12, paddingVertical: 2 }}>
              {records.length ? (
                records.map((r) => (
                  <RecordRow key={r.id} r={r} joint={joint} money={m} />
                ))
              ) : (
                <View testID="joint-records-empty" style={{ padding: 8 }}>
                  <Dimmed>
                    <RecordRow
                      r={{
                        id: "s",
                        kind: "expense",
                        amount: 125_000,
                        signed: -125_000,
                        at: "2026-01-01T00:00:00.000Z",
                        day: "2026-01-01",
                        payee: "Groceries",
                        byId: joint.owner.id,
                      }}
                      joint={joint}
                      money={m}
                    />
                  </Dimmed>
                  <EmptyFoot
                    hint="Everything paid in or out of this account lands here, with who logged it."
                    action={{
                      label: "Add a transaction",
                      onPress: () => setAdding(true),
                    }}
                  />
                </View>
              )}
              {records.length < joint.recordsTotal && liveMode && (
                <View style={{ paddingVertical: 8 }}>
                  <SmallButton
                    quiet
                    icon={Clock}
                    onPress={() => {
                      setOlderBusy(true)
                      setOlderFailed(false)
                      live()
                        .olderRecords(joint.accountId, records.length)
                        .then((o) => setOlder((x) => [...x, ...o.records]))
                        .catch(() => setOlderFailed(true))
                        .finally(() => setOlderBusy(false))
                    }}
                  >
                    {olderBusy ? "Loading…" : "Show older"}
                  </SmallButton>
                  {olderFailed && (
                    <Copy size={13} style={{ color: t.bad, marginTop: 4 }}>
                      Couldn't load older transactions. Check your connection.
                    </Copy>
                  )}
                </View>
              )}
            </Frame>
          </View>
          <Button
            tone="quiet"
            icon={LogOut}
            onPress={() =>
              confirm(
                `Leave ${joint.name}?`,
                `You stop seeing it and it leaves your net worth. ${joint.owner.name} can invite you again.`,
                () => {
                  J.leaveAccount(joint.accountId)
                  go("/finance/accounts")
                },
                "Leave",
              )
            }
          >
            Leave this account
          </Button>
          <AddRecordSheet
            joint={joint}
            open={adding}
            onClose={() => setAdding(false)}
          />
        </>
      )}
    </Screen>
  )
}

function AccountCardForJoint({ joint }: { joint: J.SharedAccount }) {
  return <JointAccountCard joint={joint} />
}

// ---------------------------------------------------------------- invite link

const DEAD: Record<
  "used" | "expired" | "revoked" | "missing",
  { icon: typeof X; title: string; detail: (who: string) => string }
> = {
  used: {
    icon: UserCheck,
    title: "This invite was already used",
    detail: (who) => `Each link works once. Ask ${who} to send you a new one.`,
  },
  expired: {
    icon: TimerOff,
    title: "This invite has expired",
    detail: (who) => `Links last 7 days. Ask ${who} for a new one.`,
  },
  revoked: {
    icon: ShieldX,
    title: "This invite was cancelled",
    detail: (who) => `${who} cancelled this link. Ask them for a new one.`,
  },
  missing: {
    icon: ShieldX,
    title: "This invite link doesn't work",
    detail: () =>
      "It may be incomplete. Open the whole link again, or ask for a new one.",
  },
}

/** What an invite link opens: /finance/invite/[token]. */
export function InviteScreen({ token }: { token: string }) {
  const t = useTheme(),
    [preview, setPreview] = useState<
      import("@/live/joint-accounts").InvitePreview | null
    >(null),
    [dead, setDead] = useState<keyof typeof DEAD | null>(null),
    [offline, setOffline] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<string | null>(null),
    [moment, closeMoment] = useMomentTimer(!!done)
  const load = useCallback(() => {
    setOffline(false)
    setDead(null)
    if (!liveMode) {
      setDead("missing")
      return
    }
    live()
      .previewInvite(token)
      .then((p) => {
        setPreview(p)
        if (
          p.state === "used" ||
          p.state === "expired" ||
          p.state === "revoked"
        )
          setDead(p.state)
      })
      .catch((e) => {
        const code = live().inviteError(e)
        if (code === "missing") setDead("missing")
        else setOffline(true)
      })
  }, [token])
  useEffect(() => load(), [load])
  // Leave for the account once the celebration has shown and closed (not
  // in the render before it first appears).
  const shown = useRef(false)
  if (moment) shown.current = true
  useEffect(() => {
    if (done && shown.current && !moment) go(done)
  }, [done, moment])
  const accept = () => {
    setBusy(true)
    setError("")
    live()
      .acceptInvite(token)
      .then((r) => {
        if (r.joined) setDone(r.href)
        else go(r.href)
      })
      .catch((e) => {
        const code = live().inviteError(e)
        if (code && code !== "own") setDead(code)
        else
          setError(
            getConnectivity()
              ? "That didn't go through. Try again."
              : "You're offline. Joining needs a connection.",
          )
      })
      .finally(() => setBusy(false))
  }
  const who = preview?.inviter.name ?? "the person who sent it"
  return (
    <Screen prototypeLayout title="Invite">
      {done && moment && preview?.subject && (
        <JoinedMoment
          name={preview.subject.title}
          owner={preview.inviter.name}
          onClose={closeMoment}
        />
      )}
      {dead ? (
        <Empty
          icon={DEAD[dead].icon}
          title={DEAD[dead].title}
          detail={DEAD[dead].detail(who)}
          action={
            <Button tone="quiet" href="/finance">
              Go to Finance
            </Button>
          }
        />
      ) : offline ? (
        <Empty
          icon={Clock}
          title="Couldn't open this invite"
          detail="Check your connection and try again."
          action={
            <Button icon={Clock} onPress={load}>
              Try again
            </Button>
          }
        />
      ) : !preview ? (
        <View testID="invite-loading" style={{ gap: 12 }}>
          <FrameSkeleton height={96} />
          <FrameSkeleton height={140} />
        </View>
      ) : (
        <Frame style={{ padding: 16, gap: 14 }} testID="invite-card">
          <Line style={{ gap: 10 }}>
            <Faces people={[preview.inviter]} size={44} />
            <View style={{ flex: 1 }}>
              <Copy size={12} muted>
                {preview.subject?.label ?? "Invite"} · from{" "}
                {preview.inviter.name}
              </Copy>
              <Copy size={22} weight="semibold">
                {preview.subject?.title ?? ""}
              </Copy>
            </View>
          </Line>
          {preview.state === "open" && preview.subject && (
            <>
              <Points points={preview.subject.points} />
              {!!error && (
                <Copy size={13} style={{ color: t.bad }}>
                  {error}
                </Copy>
              )}
              <Line style={{ gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button icon={Check} disabled={busy} onPress={accept}>
                    {busy ? "Joining…" : "Accept"}
                  </Button>
                </View>
                <View style={{ flex: 1 }}>
                  <Button tone="quiet" icon={X} href="/finance">
                    Not now
                  </Button>
                </View>
              </Line>
              <Copy size={12} muted>
                {until(preview.expiresAt)}
              </Copy>
            </>
          )}
          {preview.state === "member" && preview.subject && (
            <>
              <Line style={{ gap: 6 }}>
                <UserCheck size={16} color={t.good} />
                <Copy size={14} style={{ color: t.good }}>
                  You're already in it
                </Copy>
              </Line>
              <Button href={preview.subject.href}>Open it</Button>
            </>
          )}
          {preview.state === "own" && preview.subject && (
            <>
              <Copy size={14} muted>
                This is your own invite link. Send it to the person you want to
                share with.
              </Copy>
              <Button tone="quiet" href={preview.subject.href}>
                Open the account
              </Button>
            </>
          )}
        </Frame>
      )}
    </Screen>
  )
}

/** The joint accounts in the Shared screen: invites first, then the rest. */
export function JointList() {
  const list = useJointAccounts().filter(
    (a) =>
      (a.myStatus === "invited" || a.myStatus === "active") &&
      (a.role === "member" || isJoint(a)),
  )
  if (!list.length) return null
  return (
    <View style={{ gap: 10 }}>
      {list.map((a) =>
        a.myStatus === "invited" ? (
          <Frame key={a.id}>
            <Tap
              label={`Joint account invite: ${a.name}`}
              onPress={() => go(`/finance/shared/account/${a.accountId}`)}
              style={{ padding: 16 }}
            >
              <Line style={{ gap: 10 }}>
                <Faces people={[a.owner]} size={32} />
                <View style={{ flex: 1 }}>
                  <Copy weight="medium">{a.name}</Copy>
                  <Copy size={12} muted>
                    {a.owner.name} invited you to a joint account
                  </Copy>
                </View>
                <FinPill tone="warn">Invite</FinPill>
              </Line>
            </Tap>
          </Frame>
        ) : a.role === "member" ? (
          <JointAccountCard key={a.id} joint={a} />
        ) : (
          <Frame key={a.id}>
            <Tap
              label={`Your joint account ${a.name}`}
              onPress={() => go(`/finance/accounts/${a.accountId}`)}
              style={{ padding: 16 }}
            >
              <Line style={{ gap: 10 }}>
                <Faces people={J.activeMembers(a).map((x) => x.person)} />
                <Copy weight="medium" style={{ flex: 1 }}>
                  {a.name}
                </Copy>
                <FinPill tone="good">You own it</FinPill>
              </Line>
            </Tap>
          </Frame>
        ),
      )}
    </View>
  )
}
