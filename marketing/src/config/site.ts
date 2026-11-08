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
  // PLACEHOLDER: no public support inbox exists yet.
  contactEmail: "hello@realsolutionsph.com",
} as const

// Where the primary call to action sends people. While the App Store listing
// does not exist, every primary button goes to the waitlist form on the page.
export const CTA = {
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
  reassurance: "Free to start · just an email · iPhone first",
} as const

// The waitlist has no backend yet. When `endpoint` is null the form says so
// in plain words and offers email instead; it never pretends to save.
export const WAITLIST = {
  // PLACEHOLDER: a POST endpoint that accepts {"email": "..."} as JSON.
  endpoint: null as string | null,
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
  // Android build is not public.
  android: "coming-soon" as "coming-soon" | "shipped",
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
