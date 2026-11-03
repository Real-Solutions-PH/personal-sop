// The brand kit's trophy badge (docs/brand): one wreath of two fronds that
// meet under a ribbon, around one emblem per trophy type. 160 × 160 units.
import type { TrophyType } from "@domain/dash/hooks"
import { useMemo } from "react"
import Svg, { G, Path } from "react-native-svg"
import { useTheme } from "../theme"
import { arcFrond, frond } from "./nature"
import { leaf } from "./scribble"

/** An emblem part: "fill" carries a soft wash of the emblem colour, "thin"
 * and "thick" change the stroke. */
type Part = { d: string; kind?: "fill" | "thin" | "thick" }
const EMBLEM: Record<TrophyType, () => Part[]> = {
  // a cup with a fern engraved on it
  best: () => [
    {
      d: "M56 46 H104 V64 C104 82 94 94 80 94 C66 94 56 82 56 64 Z",
      kind: "fill",
    },
    { d: "M56 52 C44 52 42 66 54 72 M104 52 C116 52 118 66 106 72" },
    { d: "M80 94 V106 M70 112 C70 107 90 107 90 112 Z M64 118 H96" },
    {
      d: frond(80, 88, 34, -1.57, 0.1, 6, { seed: 4, leaf: 8, rib: false }),
      kind: "thin",
    },
  ],
  // a barbell over a rising line
  pr: () => [
    { d: "M48 70 H112" },
    { d: "M54 58 V82 M60 54 V86 M100 54 V86 M106 58 V82", kind: "thick" },
    { d: "M42 70 H48 M112 70 H118" },
    { d: "M52 104 C66 102 72 96 82 98 C92 100 98 90 110 86", kind: "thin" },
    { d: "M104 84 L111 85.5 L108 92", kind: "thin" },
  ],
  // a flame made of three leaves
  streak: () => [
    { d: leaf(80, 108, 58, -1.57, 0.42), kind: "fill" },
    { d: leaf(78, 106, 36, -2.05, 0.4), kind: "thin" },
    { d: leaf(82, 106, 34, -1.1, 0.4), kind: "thin" },
  ],
  // a flag on a hill
  goal: () => [
    { d: "M40 108 C58 88 70 84 82 90 C94 96 106 88 122 108 Z", kind: "fill" },
    { d: "M80 90 V42" },
    { d: "M80 44 C90 40 96 50 108 46 V64 C96 68 90 58 80 62", kind: "thin" },
  ],
  // a seedling breaking the soil
  first: () => [
    { d: "M44 104 C60 98 100 98 116 104" },
    { d: "M80 102 C80 88 79 78 80 66" },
    { d: leaf(80, 70, 30, -2.5, 0.45), kind: "fill" },
    { d: leaf(80, 66, 30, -0.6, 0.45), kind: "fill" },
    { d: "M56 110 c4 -1 8 -1 12 0 M92 110 c4 -1 8 -1 12 0", kind: "thin" },
  ],
}
const RIBBON =
  "M72 128 C76 134 84 134 88 128 M74 131 L64 152 L71 149 L74 156 L80 136 L86 156 L89 149 L96 152 L86 131"

export function TrophyBadge({
  type,
  size = 44,
  color,
}: {
  type: TrophyType
  size?: number
  /** The emblem's colour; the wreath is the brand's frond green. */
  color: string
}) {
  const t = useTheme(),
    wreath = useMemo(
      () =>
        `${arcFrond(80, 74, 58, Math.PI / 2 + 0.22, Math.PI + 1.05, 12, { seed: 11, leaf: 15, wid: 0.38 })} ${arcFrond(80, 74, 58, Math.PI / 2 - 0.22, -1.05, 12, { seed: 12, leaf: 15, wid: 0.38 })}`,
      [],
    ),
    parts = useMemo(() => EMBLEM[type](), [type])
  return (
    <Svg
      testID={`trophy-badge-${type}`}
      width={size}
      height={size}
      viewBox="0 0 160 160"
    >
      <G fill="none" strokeLinecap="round" strokeLinejoin="round">
        <Path d={wreath} stroke={t.primary} strokeWidth={1.6} />
        <Path
          d={wreath}
          stroke={t.primary}
          strokeWidth={0.9}
          opacity={0.55}
          transform="translate(.9 -.7)"
        />
        <Path d={RIBBON} stroke={color} strokeWidth={1.8} />
        <G transform="translate(80 74) scale(.86) translate(-80 -78)">
          {parts.map((p) => (
            <Path
              key={p.d}
              d={p.d}
              stroke={color}
              strokeWidth={
                p.kind === "thin" ? 1.6 : p.kind === "thick" ? 4.5 : 2.6
              }
              fill={p.kind === "fill" ? `${color.slice(0, 7)}2e` : "none"}
            />
          ))}
        </G>
      </G>
    </Svg>
  )
}
