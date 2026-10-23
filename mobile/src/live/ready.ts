// Whether this device knows the account's state yet: an earlier launch
// already pulled, or this launch's first pull has finished (or failed).
// Until then the blank stores say "not onboarded" for everyone, so the
// first-run gate waits instead of sending a returning person to onboarding.
import { create } from "zustand"
import { liveMode } from "./config"

export const syncReady = create<{ ready: boolean }>(() => ({
  ready: !liveMode,
}))
