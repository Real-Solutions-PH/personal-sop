export type FernMood =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "celebrating"
  | "consoling"

// Fern, the C1 wreath sprite, as a pre-rendered SVG file (scripts/gen-fern.mjs)
// that carries its own animation and reduced-motion rule. Decorative: the
// words next to Fern always say what it is doing.
export function Fern({
  mood = "idle",
  still = false,
  className = "",
  size = 200,
  eager = false,
}: {
  mood?: FernMood
  still?: boolean
  className?: string
  size?: number
  eager?: boolean
}) {
  const file = still && mood === "celebrating" ? "celebrating-still" : mood
  return (
    // biome-ignore lint/performance/noImgElement: static export, no image optimiser
    <img
      className={`fern-img ${className}`}
      src={`/fern/${file}.svg`}
      alt=""
      width={size}
      height={size}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
    />
  )
}
