// Every value a launch decision can change lives here. Values marked
// PLACEHOLDER are honest stand-ins: swap them, never invent around them.

export const SITE = {
  name: "Unfurl",
  // PLACEHOLDER: the production domain is not chosen. Cloudflare holds
  // realsolutionsph.com; the brand doc suggests unfurl.day or unfurlapp.co.
  url: "https://unfurl.realsolutionsph.com",
  title: "Unfurl: the life tracker you talk to",
  tagline: "Say it. It's tracked.",
  description:
    "Tell Fern what happened in a sentence, a voice note or a photo. Unfurl files it as habits, tasks, workouts, meals, money, journal and focus. One app instead of five.",
  company: "Real Solutions PH",
  // PLACEHOLDER: no public support inbox exists yet. While contactEmailLive
  // is false the address is never shown or offered anywhere on the site.
  contactEmail: "hello@realsolutionsph.com",
  contactEmailLive: false as boolean,
  // Pre-launch: noindex everywhere and no sitemap entries until Kai opens
  // the site. Flip to true on launch.
  indexable: false as boolean,
} as const

// Where the primary call to action sends people. While the App Store listing
// does not exist, every primary button goes to the waitlist form on the page.
export const CTA = {
  // The app is React Native and runs on iPhone and Android.
  // PLACEHOLDER: set to the App Store URL when the listing is live; the
  // buttons switch from "Join the waitlist" to "Download on the App Store".
  appStoreUrl: null as string | null,
  // PLACEHOLDER: a public TestFlight link, if Kai opens one.
  testFlightUrl: null as string | null,
  primaryLabel: "Join the waitlist",
  primaryHref: "#waitlist",
  // The low-commitment line under every primary button. It must stay true:
  // the app still needs an account until local-only mode ships, so this
  // says "free to start" and "just an email", never "no account needed".
  reassurance: "Free to start · just an email · iPhone and Android",
} as const

// The waitlist has no backend yet. When `endpoint` is null the form says so
// in plain words and offers email instead; it never pretends to save.
export const WAITLIST = {
  // PLACEHOLDER: a POST endpoint that accepts {"email": "..."} as JSON.
  endpoint: null as string | null,
} as const

// A listed-but-unbuilt browser version, put up to measure demand before
// building it (interview kit 2026-11-09, section 4; Kai asked for it on
// 2026-11-09). Every primary button carries a "join that list" link, and the
// waitlist form has a matching checkbox; the signal is how many sign-ups tick
// it. Set listed to false to take it down; the copy always says it isn't built.
export const BROWSER_VERSION = {
  listed: true as boolean,
  linkLabel: "Rather use it in a browser? Join that list",
} as const

// Social proof. Null means "no real number yet": the section shows a true
// sentence instead of a count. Fill these only with measured figures.
export const PROOF = {
  // PLACEHOLDER: number of TestFlight testers, from App Store Connect.
  testers: null as number | null,
  // PLACEHOLDER: App Store rating and review count, once the app is listed.
  rating: null as { stars: number; count: number } | null,
  // PLACEHOLDER: real quotes from testers, with their permission and name.
  quotes: [] as { text: string; name: string; context: string }[],
} as const

// Shipped-or-not switches for claims that depend on work in progress.
export const FEATURE_STATUS = {
  // Local-only mode (no account, no sync) is in progress, not shipped.
  localOnlyMode: "coming-soon" as "coming-soon" | "shipped",
} as const

// Credit for the music in the hero video (CC BY 4.0 requires attribution).
export const MEDIA_CREDITS = [
  {
    work: "Happy Beats / Business Moves Vol. 1",
    author: "Sascha Ende",
    url: "https://ende.app",
    license: "CC BY 4.0",
  },
] as const
