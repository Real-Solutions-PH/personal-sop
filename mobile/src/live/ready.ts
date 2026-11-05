// Whether this device knows the account's state yet: an earlier launch
// already pulled, or this launch's first pull has finished (or failed).
// Until then the blank stores say "not onboarded" for everyone, so the
// first-run gate waits instead of sending a returning person to onboarding.
import { create } from "zustand"
import { liveMode } from "./config"

// ``failed``: ready only because the first pull failed, so this device
// still holds none of the account's rows; cleared once a pull lands.
export const syncReady = create<{ ready: boolean; failed?: boolean }>(() => ({
  ready: !liveMode,
}))
