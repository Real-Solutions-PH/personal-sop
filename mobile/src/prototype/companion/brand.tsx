// Fern, the companion's brand: the palette and the fiddlehead mark.
// docs/brand/fern.md is the guide; keep the two in step.

import Svg, { Path } from "react-native-svg"

export { COMPANION_NAME } from "./store"

const LIGHT = {
  moss: "#1F5A43",
  frond: "#3B8A5A",
  sprout: "#A6D277",
  mist: "#EAF3EC",
}
const DARK = {
  moss: "#2C7A5A",
  frond: "#6BBF8A",
  sprout: "#B7E08A",
  mist: "#16261D",
}

export type FernPalette = typeof LIGHT

export const fernPalette = (dark: boolean): FernPalette => (dark ? DARK : LIGHT)

/**
 * The fiddlehead: a frond unfurling from its spiral, drawn as one stroke.
 * Reads from 16 pt up; below that use the orb alone.
 */
export function FernMark({
  size = 24,
  color,
  weight = 2,
}: {
  size?: number
  color: string
  weight?: number
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* stem rising into a spiral of about one and a half turns */}
      <Path
        d="M7.5 21.5 C7.5 16.5 8.6 12.6 11.6 10.1 C14.2 7.9 18.7 8.4 18.9 12.1 C19.1 15 16 16.4 14 14.9 C12.5 13.8 12.9 11.4 14.8 11.2 C16.1 11.1 16.9 12.3 16.2 13.2"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* two young leaflets on the stem */}
      <Path
        d="M8 18 C6.3 17 4.6 17.2 3.6 18.5"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
      />
      <Path
        d="M8.9 14.4 C7.5 13.2 5.8 13 4.7 13.9"
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="round"
      />
    </Svg>
  )
}
