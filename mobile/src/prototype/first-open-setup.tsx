import type { ModuleKey } from "@domain/contract"
import { type ReactNode, useEffect } from "react"
import { go } from "./navigation"
import { markOffered, useOfferSetup } from "./setup-plan"

/** Wraps a module's home screen: the first time it is opened without its
 * starting data (and its setup was neither done nor skipped), its setup
 * step opens over it, once. Done or skipped, setup comes back here. */
export function FirstOpenSetup({
  module,
  href,
  children,
}: {
  module: ModuleKey
  href: string
  children: ReactNode
}) {
  const offer = useOfferSetup(module)
  useEffect(() => {
    if (!offer) return
    markOffered(module)
    go(`/setup?step=${module}&return=${encodeURIComponent(href)}`)
  }, [offer, module, href])
  return children
}
