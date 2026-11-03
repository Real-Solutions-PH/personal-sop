// The five mood marks in the brand's leaf line, in place of face icons
// (card library, Journal): Rough wilts, Meh curls, Okay levels, Good lifts,
// Great opens. Each takes lucide's `size` and `color`, so it drops in
// wherever a mood icon sat.
import type { Mood } from "@domain/capture/data"
import Svg, { Path } from "react-native-svg"
import { curl } from "./nature"
import { leaf } from "./scribble"

const PI = Math.PI

/** Stem (stroked) and leaves (filled) per mood, on a 24-unit grid. */
const SHAPES: Record<Mood, { stem: string; leaves: string }> = {
  1: {
    stem: "M11 22 C11 15 13 11 17 10",
    leaves: leaf(17, 10, 8, PI * 0.62, 0.36),
  },
  2: {
    stem: `M12 22 L12 12 ${curl(12, 12, -PI / 2, 2.6, 1, 14, 0.5)}`,
    leaves: "",
  },
  3: {
    stem: "M12 22 C12 17 12 14 11 12",
    leaves: leaf(11, 12.5, 10, -0.05, 0.36),
  },
  4: {
    stem: "M12 22 C12 16 12 12 12 9",
    leaves: leaf(12, 11, 11, -PI * 0.36, 0.36),
  },
  5: {
    stem: "M12 22 L12 6",
    leaves: `${leaf(12, 11, 9, -PI * 0.2, 0.38)} ${leaf(12, 11, 9, -PI * 0.8, 0.38)} ${leaf(12, 7, 5, -PI / 2, 0.5)}`,
  },
}

function MoodLeaf({
  mood,
  size = 24,
  color,
}: {
  mood: Mood
  size?: number
  color: string
}) {
  const s = SHAPES[mood]
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d={s.stem}
        fill="none"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {s.leaves ? <Path d={s.leaves} fill={color} /> : null}
    </Svg>
  )
}

type MarkProps = { size?: number; color: string }
export const moodLeaves: Record<
  Mood,
  (p: MarkProps) => ReturnType<typeof MoodLeaf>
> = {
  1: (p) => <MoodLeaf mood={1} {...p} />,
  2: (p) => <MoodLeaf mood={2} {...p} />,
  3: (p) => <MoodLeaf mood={3} {...p} />,
  4: (p) => <MoodLeaf mood={4} {...p} />,
  5: (p) => <MoodLeaf mood={5} {...p} />,
}
