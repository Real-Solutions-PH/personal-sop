import { dashStore } from "@domain/dash/store"
import { LinearGradient } from "expo-linear-gradient"
import { Image, Text, View } from "react-native"
import { socialStore } from "./social/store"
import { fonts, useTheme } from "./theme"
export function ProfileAvatar({ size = 68 }: { size?: number }) {
  const t = useTheme(),
    profile = dashStore.use((s) => s.profile),
    // The photo set on another device, until this one picks its own.
    synced = socialStore.use((s) => s.me?.photo),
    p = { ...profile, photo: profile.photo || synced }
  return (
    <LinearGradient
      colors={[t.hab, t.primary, t.fit]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ height: size, width: size, borderRadius: size / 2, padding: 3 }}
    >
      {p.photo ? (
        <Image
          source={{ uri: p.photo }}
          accessibilityLabel={p.name}
          style={{
            height: size - 6,
            width: size - 6,
            borderRadius: size / 2,
            backgroundColor: t.card,
          }}
        />
      ) : (
        <View
          style={{
            flex: 1,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.card,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.bold,
              fontSize: size * 0.36,
              letterSpacing: -0.6,
              color: t.text,
            }}
          >
            {p.name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((n) => n[0]?.toUpperCase())
              .join("")}
          </Text>
        </View>
      )}
    </LinearGradient>
  )
}
