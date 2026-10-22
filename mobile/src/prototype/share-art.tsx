import { LinearGradient } from "expo-linear-gradient"
import { Image, Text, View } from "react-native"
import { fonts, useTheme } from "./theme"
import { Ring } from "./visual"
export const shareKinds = [
  "life",
  "weekly",
  "monthly",
  "streak",
  "tasks",
  "finance",
  "profile",
  "goal",
] as const
export const shareLabels: Record<string, string> = {
  life: "Life Score",
  weekly: "Week recap",
  monthly: "Month recap",
  streak: "Streak",
  tasks: "Tasks",
  finance: "Money habits",
  profile: "Identity",
  goal: "Goals",
}
export function ShareArtwork({
  kind,
  score,
  name,
  metrics,
  identities,
  background,
  photo,
  days,
  compact = false,
}: {
  kind: string
  score: number | null
  name?: string
  metrics: { label: string; value: string }[]
  identities: string[]
  background: string
  photo?: string
  days: number
  compact?: boolean
}) {
  const t = useTheme(),
    paper = background === "paper" || background === "sticker",
    ink = paper ? t["share-paper-ink"] : "#ffffff",
    muted = paper ? "#454342" : "#ffffffaa"
  const colors: readonly [string, string, string] =
    background === "sticker"
      ? ["transparent", "transparent", "transparent"]
      : paper
        ? [t["share-paper"], t["share-paper"], t["share-paper"]]
        : background === "night"
          ? [t["share-night"], t["share-night"], t["share-night"]]
          : [t["hero-from"], t["share-vivid-to"], t["hero-to"]]
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={{
        flex: 1,
        padding: compact ? 14 : 20,
        justifyContent: "space-between",
        overflow: "hidden",
        borderRadius: 22,
      }}
    >
      {background === "photo" && photo && (
        <Image
          source={{ uri: photo }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            opacity: 0.25,
          }}
        />
      )}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 10,
            letterSpacing: 1,
            color: ink,
          }}
        >
          {shareLabels[kind].toUpperCase()}
        </Text>
        <Text style={{ fontFamily: fonts.medium, fontSize: 9, color: muted }}>
          LAST {days} DAYS
        </Text>
      </View>
      <View style={{ alignItems: "center", gap: compact ? 8 : 14 }}>
        {kind === "life" || kind === "monthly" ? (
          <Ring size={compact ? 76 : 132} value={(score ?? 0) / 100} hero>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: compact ? 32 : 52,
                color: ink,
              }}
            >
              {score ?? "—"}
            </Text>
            <Text
              style={{ fontFamily: fonts.medium, fontSize: 11, color: muted }}
            >
              OF 100
            </Text>
          </Ring>
        ) : (
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: compact ? 26 : kind === "profile" ? 32 : 40,
              textAlign: "center",
              color: ink,
            }}
          >
            {kind === "profile"
              ? name || "BECOMING BETTER"
              : kind === "weekly"
                ? "ONE WEEK STRONGER"
                : kind === "streak"
                  ? "KEEP SHOWING UP"
                  : kind === "tasks"
                    ? "MADE IT HAPPEN"
                    : kind === "finance"
                      ? "PAYING MYSELF FIRST"
                      : "A LITTLE CLOSER"}
          </Text>
        )}
        <Text
          style={{
            fontFamily: fonts.semibold,
            fontSize: 11,
            letterSpacing: 1,
            color: paper ? t.life : "#e9b962",
          }}
        >
          {kind === "life"
            ? "PROGRESS, NOT PERFECTION"
            : shareLabels[kind].toUpperCase()}
        </Text>
        {kind === "profile" ? (
          identities.slice(0, compact ? 2 : 3).map((v, i) => (
            <Text
              key={`${i}-${v}`}
              style={{
                fontFamily: fonts.displayMedium,
                fontSize: 22,
                textAlign: "center",
                color: ink,
              }}
            >
              {v}
            </Text>
          ))
        ) : (
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 12,
              justifyContent: "center",
            }}
          >
            {metrics.slice(0, compact ? 2 : 4).map((m, i) => (
              <View
                key={`${i}-${m.label}`}
                style={{
                  width: "44%",
                  padding: 10,
                  borderRadius: 12,
                  backgroundColor: paper ? "#00000008" : "#ffffff0d",
                  gap: 5,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 23,
                    color: ink,
                  }}
                >
                  {m.value}
                </Text>
                <Text
                  style={{ fontFamily: fonts.body, fontSize: 10, color: muted }}
                >
                  {m.label}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <Text style={{ fontFamily: fonts.medium, fontSize: 11, color: muted }}>
          {name}
        </Text>
        <Text
          style={{
            fontFamily: fonts.medium,
            fontSize: 12,
            letterSpacing: -0.36,
            color: ink,
          }}
        >
          unfurl
        </Text>
      </View>
    </LinearGradient>
  )
}
