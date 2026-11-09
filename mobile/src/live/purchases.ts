// The App Store side of Unfurl Plus, through RevenueCat (ADR-0037). The one
// seam the app buys through: the paywall asks for the offers, buys one or
// restores, and then asks the SERVER for the plan. Nothing here decides
// whether the account is Plus.
//
// RevenueCat signs in with the account id, so a purchase belongs to the
// account: a reinstall or a second phone on the same account restores it.
// The public iOS key comes from EXPO_PUBLIC_REVENUECAT_IOS_KEY at build
// time; without it (a local build, the web, the demo) purchases are
// unavailable and the paywall says so.
import { Platform } from "react-native"
import { liveMode } from "./config"

export type ProductId = "plus_monthly" | "plus_yearly"
export const PRODUCTS: readonly ProductId[] = ["plus_yearly", "plus_monthly"]
export const ENTITLEMENT = "plus"

export interface Offer {
  id: ProductId
  /** The store's price in the person's currency ("$49.99", "₱1,490.00"). */
  price: string
  /** Yearly: the same price spread per month, as the store formats it. */
  perMonth: string | null
}

export interface PurchasesApi {
  offers(): Promise<Offer[]>
  /** "cancelled": the person closed the App Store sheet. Throws on a
   * failure the person should hear about. */
  buy(id: ProductId): Promise<"bought" | "cancelled">
  /** Whether the store holds a Plus purchase for this account. */
  restore(): Promise<boolean>
}

const KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ""

type RC = typeof import("react-native-purchases").default
let rc: RC | null = null
let configuredFor: string | null = null

function native(): RC | null {
  if (rc) return rc
  if (!liveMode || Platform.OS !== "ios" || !KEY) return null
  try {
    rc = (
      require("react-native-purchases") as typeof import("react-native-purchases")
    ).default
  } catch {
    rc = null
  }
  return rc
}

/** Signs RevenueCat in as this account (the session calls it on sign-in and
 * on a restored launch). Safe to call again for the same account. */
export async function configurePurchases(userId: string): Promise<void> {
  const p = native()
  if (!p || configuredFor === userId) return
  try {
    if (configuredFor === null) p.configure({ apiKey: KEY, appUserID: userId })
    else await p.logIn(userId)
    configuredFor = userId
  } catch {
    // The store is unreachable: the paywall retries when it opens.
  }
}

/** Signing out: the next account must not inherit this one's purchases. */
export async function signOutPurchases(): Promise<void> {
  const p = native()
  if (!p || configuredFor === null) return
  try {
    await p.logOut()
  } catch {}
  configuredFor = null
}

const cancelled = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  ((e as { userCancelled?: boolean }).userCancelled === true ||
    (e as { code?: string }).code === "1")

function revenueCat(p: RC): PurchasesApi {
  const packages = async () => {
    const offerings = await p.getOfferings()
    return (offerings.current?.availablePackages ?? []).filter((pkg) =>
      PRODUCTS.includes(pkg.product.identifier as ProductId),
    )
  }
  return {
    async offers() {
      return (await packages()).map((pkg) => ({
        id: pkg.product.identifier as ProductId,
        price: pkg.product.priceString,
        perMonth:
          pkg.product.identifier === "plus_yearly"
            ? pkg.product.pricePerMonthString
            : null,
      }))
    },
    async buy(id) {
      const pkg = (await packages()).find((x) => x.product.identifier === id)
      if (!pkg) throw new Error("offer not available")
      try {
        await p.purchasePackage(pkg)
        return "bought"
      } catch (e) {
        if (cancelled(e)) return "cancelled"
        throw e
      }
    },
    async restore() {
      const info = await p.restorePurchases()
      return info.entitlements.active[ENTITLEMENT] !== undefined
    },
  }
}

let override: PurchasesApi | null | undefined
/** Tests (and the demo) substitute the store here; undefined: the real one. */
export function setPurchases(api: PurchasesApi | null | undefined) {
  override = api
}

/** The store, or null when this build cannot buy. */
export function purchases(): PurchasesApi | null {
  if (override !== undefined) return override
  const p = native()
  return p ? revenueCat(p) : null
}
