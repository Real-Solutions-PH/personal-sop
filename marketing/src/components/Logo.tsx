// The Unfurl lockup: the flat fiddlehead mark and the lowercase wordmark.
// Always flat (no gradient, glow or shadow), per ADR-0019.
export function Mark({ title }: { title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M7.5 21.5 C7.5 16.5 8.6 12.6 11.6 10.1 C14.2 7.9 18.7 8.4 18.9 12.1 C19.1 15 16 16.4 14 14.9 C12.5 13.8 12.9 11.4 14.8 11.2 C16.1 11.1 16.9 12.3 16.2 13.2" />
      <path d="M8 18 C6.3 17 4.6 17.2 3.6 18.5" />
      <path d="M8.9 14.4 C7.5 13.2 5.8 13 4.7 13.9" />
    </svg>
  )
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <a className="logo" href={href} aria-label="Unfurl, home">
      <Mark />
      <span>unfurl</span>
    </a>
  )
}
