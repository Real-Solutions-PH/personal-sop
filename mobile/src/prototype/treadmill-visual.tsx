// A treadmill session's picture where an outdoor one shows its map: the
// machine side-on, its deck raised to the incline, in the same box and
// height so the screen keeps its shape. Line art in the Fitness accent.
import { View } from "react-native"
import Svg, { Circle, Line, Path, Rect } from "react-native-svg"
import { Copy } from "./native-kit"
import { useTheme } from "./theme"

export function TreadmillVisual({
  height = 220,
  inclinePct,
  caption,
}: {
  height?: number
  /** The deck's rise, drawn up to 15% (past that it would leave the box). */
  inclinePct?: number
  /** One quiet line under the machine, e.g. "Distance from the treadmill". */
  caption?: string
}) {
  const t = useTheme()
  // Drawn in a 320 × 160 space; the deck pivots on its rear roller.
  const rise = Math.min(15, Math.max(0, inclinePct ?? 0)) / 100
  const rear = { x: 60, y: 128 }
  const len = 190
  const front = { x: rear.x + len, y: rear.y - len * rise * 2.2 }
  const angle = Math.atan2(front.y - rear.y, front.x - rear.x)
  const deck = (dx: number, dy: number) => ({
    x: rear.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: rear.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  })
  const belt = [6, 12, 18].map((d) => deck(0, -d))
  const stroke = t.fit
  return (
    <View
      testID="treadmill"
      accessible
      accessibilityLabel={`Treadmill${inclinePct ? ` at ${inclinePct}% incline` : ""}`}
      style={{
        height,
        borderRadius: 16,
        overflow: "hidden",
        backgroundColor: t.soft,
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Svg
        width="86%"
        height={Math.max(80, height - 56)}
        viewBox="0 0 320 160"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Floor */}
        <Line
          x1={20}
          y1={146}
          x2={300}
          y2={146}
          stroke={stroke}
          strokeOpacity={0.25}
          strokeWidth={3}
          strokeLinecap="round"
        />
        {/* Base and feet */}
        <Path
          d={`M ${rear.x - 8} 146 L ${rear.x} ${rear.y + 8} M ${front.x - 4} 146 L ${front.x} ${front.y + 8}`}
          stroke={stroke}
          strokeOpacity={0.5}
          strokeWidth={5}
          strokeLinecap="round"
        />
        {/* Deck with its belt */}
        <Line
          x1={rear.x}
          y1={rear.y}
          x2={front.x}
          y2={front.y}
          stroke={stroke}
          strokeWidth={10}
          strokeLinecap="round"
        />
        <Line
          x1={belt[0].x}
          y1={belt[0].y}
          x2={belt[0].x + len * Math.cos(angle)}
          y2={belt[0].y + len * Math.sin(angle)}
          stroke={stroke}
          strokeOpacity={0.35}
          strokeWidth={2}
          strokeDasharray="10 8"
        />
        <Circle
          cx={rear.x}
          cy={rear.y}
          r={7}
          fill={t.soft}
          stroke={stroke}
          strokeWidth={3}
        />
        <Circle
          cx={front.x}
          cy={front.y}
          r={7}
          fill={t.soft}
          stroke={stroke}
          strokeWidth={3}
        />
        {/* Upright, handrail and console */}
        <Line
          x1={front.x - 6}
          y1={front.y - 4}
          x2={front.x + 10}
          y2={30}
          stroke={stroke}
          strokeWidth={7}
          strokeLinecap="round"
        />
        <Line
          x1={front.x + 6}
          y1={52}
          x2={front.x - 52}
          y2={60}
          stroke={stroke}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <Rect
          x={front.x - 14}
          y={14}
          width={44}
          height={24}
          rx={6}
          fill={t.card}
          stroke={stroke}
          strokeWidth={3}
        />
        <Line
          x1={front.x - 6}
          y1={26}
          x2={front.x + 22}
          y2={26}
          stroke={stroke}
          strokeOpacity={0.5}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </Svg>
      {caption ? (
        <Copy
          size={12}
          muted
          style={{ paddingHorizontal: 16, textAlign: "center" }}
        >
          {caption}
        </Copy>
      ) : null}
    </View>
  )
}
