// Unfurl Plus: the paywall, and the plan once it is held (ADR-0037).
// Yearly first with what it comes to a month, monthly second, Restore
// purchases, the terms and privacy pages, and a close. Prices are the
// store's own strings, in the person's currency. After a purchase or a
// restore the screen asks the SERVER for the plan and shows Plus only once
// the server says so.
import {
  Check,
  CircleAlert,
  Gem,
  RotateCcw,
  Store,
  X,
} from "lucide-react-native"
import { useEffect, useRef, useState } from "react"
import { ActivityIndicator, Linking, View } from "react-native"
import { toast } from "sonner-native"
import {
  type Offer,
  PRODUCTS,
  type ProductId,
  purchases,
} from "@/live/purchases"
import { Copy, Frame, IconTap, Line, SectionHeading, Tap } from "../native-kit"
import { back } from "../navigation"
import { planStore, plusInForce, refreshPlan } from "../plan"
import { useTheme } from "../theme"
import { Button, Screen } from "../ui"
import { logUsage } from "../usage"

export const TERMS_URL = "https://unfurl.realsolutionsph.com/terms"
export const PRIVACY_URL = "https://unfurl.realsolutionsph.com/privacy"
const MANAGE_URL = "https://apps.apple.com/account/subscriptions"

// After a purchase the server hears from RevenueCat within seconds; it is
// asked again every few seconds for up to a minute (inside the server's
// per-person limit of 10 refreshes a minute).
const CONFIRM_TRIES = 10
const CONFIRM_EVERY_MS = 6_000

const FEATURES = [
  "Everything in Free, including export of all your data",
  "Fern beyond the free daily allowance, up to a monthly fair-use budget, then a lighter model",
]

type Load = "loading" | "ready" | "error" | "unavailable"

function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function Plus() {
  const t = useTheme()
  const plan = planStore.use((s) => s)
  const plus = plusInForce(plan)
  const [load, setLoad] = useState<Load>("loading")
  const [offers, setOffers] = useState<Offer[]>([])
  const [busy, setBusy] = useState<ProductId | "restore" | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const alive = useRef(true)
  // A second tap before the first re-render must not start a second buy.
  const working = useRef(false)

  const loadOffers = useRef(async () => {
    const store = purchases()
    if (!store) {
      setLoad("unavailable")
      return
    }
    setLoad("loading")
    try {
      const got = await store.offers()
      if (!alive.current) return
      const sorted = PRODUCTS.flatMap((id) => got.filter((o) => o.id === id))
      setOffers(sorted)
      setLoad(sorted.length ? "ready" : "error")
    } catch {
      if (alive.current) setLoad("error")
    }
  }).current

  useEffect(() => {
    alive.current = true
    if (!plusInForce(planStore.get())) logUsage({ kind: "paywall_shown" })
    void refreshPlan()
    void loadOffers()
    return () => {
      alive.current = false
    }
  }, [loadOffers])

  /** Asks the server until it reports Plus (or a minute passes). */
  const confirm = async (after: "purchase" | "restore") => {
    setConfirming(true)
    for (let i = 0; i < CONFIRM_TRIES && alive.current; i++) {
      const got = await refreshPlan()
      if (got && plusInForce(got)) break
      await new Promise((r) => setTimeout(r, CONFIRM_EVERY_MS))
    }
    if (!alive.current) return
    setConfirming(false)
    if (!plusInForce(planStore.get()))
      setNote(
        after === "purchase"
          ? "Your purchase went through. Plus turns on as soon as the App Store confirms it, usually within a minute."
          : "The App Store found your purchase. Plus turns on as soon as it is confirmed; if it doesn't, try again in a minute.",
      )
  }

  const buy = async (id: ProductId) => {
    const store = purchases()
    if (!store || working.current) return
    working.current = true
    setNote(null)
    setBusy(id)
    logUsage({ kind: "purchase_started", detail: id })
    try {
      const result = await store.buy(id)
      if (result === "bought") await confirm("purchase")
      else if (result === "pending")
        setNote(
          "Your purchase is waiting for approval. Plus turns on once it's approved.",
        )
    } catch {
      toast.error(
        "The purchase didn't finish. If you were charged, Plus turns on shortly, or tap Restore purchases.",
      )
      // The store may still finish it: ask the server once.
      void refreshPlan()
    } finally {
      working.current = false
      if (alive.current) setBusy(null)
    }
  }

  const restore = async () => {
    const store = purchases()
    if (!store || working.current) return
    working.current = true
    setNote(null)
    setBusy("restore")
    try {
      if (await store.restore()) {
        logUsage({ kind: "restored" })
        await confirm("restore")
      } else {
        await refreshPlan()
        if (alive.current && !plusInForce(planStore.get()))
          setNote("No Unfurl Plus purchase found for this Apple ID.")
      }
    } catch {
      toast.error("Couldn't restore purchases. Try again.")
    } finally {
      working.current = false
      if (alive.current) setBusy(null)
    }
  }

  const close = <IconTap icon={X} label="Close" onPress={() => back("/me")} />

  const links = (
    <Line style={{ justifyContent: "center", gap: 20, marginTop: 8 }}>
      <Tap label="Terms of use" onPress={() => void Linking.openURL(TERMS_URL)}>
        <Copy size={12} muted>
          Terms of use
        </Copy>
      </Tap>
      <Tap
        label="Privacy policy"
        onPress={() => void Linking.openURL(PRIVACY_URL)}
      >
        <Copy size={12} muted>
          Privacy policy
        </Copy>
      </Tap>
    </Line>
  )

  const restoreButton = (
    <Tap
      label="Restore purchases"
      onPress={() => void restore()}
      style={{
        alignSelf: "center",
        paddingVertical: 10,
        paddingHorizontal: 12,
      }}
    >
      <Line style={{ gap: 8 }}>
        {busy === "restore" ? (
          <ActivityIndicator size="small" color={t.muted} />
        ) : (
          <RotateCcw size={16} color={t.muted} />
        )}
        <Copy size={14} weight="medium" muted>
          Restore purchases
        </Copy>
      </Line>
    </Tap>
  )

  if (plus) {
    const until = day(plan.plusUntil)
    return (
      <Screen title="Unfurl Plus" actions={close}>
        <Frame testID="plus-active" style={{ padding: 16, gap: 8 }}>
          <Line style={{ gap: 10 }}>
            <Gem size={20} color={t.primary} />
            <Copy size={20} weight="semibold">
              You have Unfurl Plus
            </Copy>
          </Line>
          {until && (
            <Copy size={14} muted>
              {plan.willRenew ? `Renews ${until}` : `Ends ${until}`}
            </Copy>
          )}
        </Frame>
        <SectionHeading>Included</SectionHeading>
        <Features />
        <View style={{ gap: 8, marginTop: 16 }}>
          <Button tone="quiet" onPress={() => void Linking.openURL(MANAGE_URL)}>
            Manage subscription
          </Button>
          {restoreButton}
          {links}
        </View>
      </Screen>
    )
  }

  return (
    <Screen title="Unfurl Plus" eyebrow="Upgrade" actions={close}>
      <Copy size={16} muted style={{ marginBottom: 8 }}>
        Keep Fern close every day, for everything you track.
      </Copy>
      <Features />
      <SectionHeading>Choose a plan</SectionHeading>
      {load === "loading" && (
        <Frame
          testID="plus-loading"
          style={{ padding: 24, alignItems: "center" }}
        >
          <ActivityIndicator color={t.primary} />
        </Frame>
      )}
      {load === "unavailable" && (
        <Frame testID="plus-unavailable" style={{ padding: 16 }}>
          <Line>
            <Store size={18} color={t.muted} />
            <Copy size={14} muted style={{ flex: 1 }}>
              Purchases aren't available in this version of the app yet.
            </Copy>
          </Line>
        </Frame>
      )}
      {load === "error" && (
        <Frame testID="plus-load-error" style={{ padding: 16, gap: 12 }}>
          <Line>
            <CircleAlert size={18} color={t.bad} />
            <Copy size={14} style={{ flex: 1 }}>
              Couldn't load the plans from the App Store.
            </Copy>
          </Line>
          <Button
            tone="quiet"
            small
            icon={RotateCcw}
            onPress={() => void loadOffers()}
          >
            Try again
          </Button>
        </Frame>
      )}
      {load === "ready" && (
        <View style={{ gap: 10 }}>
          {offers.map((o) => (
            <OfferCard
              key={o.id}
              offer={o}
              busy={busy === o.id}
              disabled={busy !== null || confirming}
              onPress={() => void buy(o.id)}
            />
          ))}
        </View>
      )}
      {confirming && (
        <Line
          testID="plus-confirming"
          style={{ justifyContent: "center", marginTop: 12 }}
        >
          <ActivityIndicator size="small" color={t.primary} />
          <Copy size={14} muted>
            Confirming with the App Store…
          </Copy>
        </Line>
      )}
      {note && (
        <Copy size={14} muted style={{ textAlign: "center", marginTop: 12 }}>
          {note}
        </Copy>
      )}
      <View style={{ marginTop: 12 }}>
        {load !== "unavailable" && restoreButton}
        <Copy size={12} muted style={{ textAlign: "center", marginTop: 4 }}>
          Billed through your Apple ID. Renews automatically until you cancel in
          your App Store settings, at least 24 hours before the period ends.
        </Copy>
        {links}
      </View>
    </Screen>
  )
}

function Features() {
  const t = useTheme()
  return (
    <Frame style={{ padding: 16, gap: 10 }}>
      {FEATURES.map((f) => (
        <Line key={f} style={{ alignItems: "flex-start", gap: 10 }}>
          <Check size={16} color={t.primary} style={{ marginTop: 3 }} />
          <Copy size={14} style={{ flex: 1 }}>
            {f}
          </Copy>
        </Line>
      ))}
    </Frame>
  )
}

function OfferCard({
  offer,
  busy,
  disabled,
  onPress,
}: {
  offer: Offer
  busy: boolean
  disabled: boolean
  onPress: () => void
}) {
  const t = useTheme()
  const yearly = offer.id === "plus_yearly"
  return (
    <Tap
      label={yearly ? "Subscribe yearly" : "Subscribe monthly"}
      onPress={disabled ? () => {} : onPress}
      style={{ borderRadius: 16 }}
    >
      <View
        testID={`offer-${offer.id}`}
        style={{
          borderWidth: yearly ? 2 : 1,
          borderColor: yearly ? t.primary : t.line,
          backgroundColor: t.card,
          borderRadius: 16,
          padding: 16,
          gap: 4,
          opacity: disabled && !busy ? 0.6 : 1,
        }}
      >
        <Line style={{ justifyContent: "space-between" }}>
          <Copy size={16} weight="semibold">
            {yearly ? "Yearly" : "Monthly"}
          </Copy>
          {busy ? (
            <ActivityIndicator size="small" color={t.primary} />
          ) : yearly ? (
            <View
              style={{
                backgroundColor: t.primary,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Copy size={11} weight="medium" style={{ color: t.onPrimary }}>
                Best value
              </Copy>
            </View>
          ) : null}
        </Line>
        <Copy size={18} weight="medium">
          {yearly ? `${offer.price} a year` : `${offer.price} a month`}
        </Copy>
        {yearly && offer.perMonth && (
          <Copy size={14} muted>
            {`${offer.perMonth} a month, billed yearly`}
          </Copy>
        )}
      </View>
    </Tap>
  )
}
