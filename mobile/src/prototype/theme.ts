import { fonts, palette, radius, space } from "@domain/design/tokens"
import { createStore } from "@domain/lib/store"
import { createContext, useContext } from "react"
import { useColorScheme } from "react-native"

export { fonts, radius, space }
export type Accent = "primary" | "hab" | "tsk" | "fit" | "nut" | "fin" | "life"
export const AccentContext = createContext<Accent>("primary")
export const accents = palette.light
export const appearanceStore = createStore<{
  mode: "system" | "light" | "dark"
}>("native-appearance", () => ({ mode: "system" }))
export function useTheme() {
  const system = useColorScheme()
  const mode = appearanceStore.use((s) => s.mode)
  const dark = (mode === "system" ? system : mode) === "dark"
  const p = palette[dark ? "dark" : "light"]
  const key = useContext(AccentContext)
  return {
    ...p,
    dark,
    accent: p[key],
    bg: p.background,
    card: p.card,
    text: p.foreground,
    muted: p["muted-foreground"],
    line: p.border,
    soft: p.muted,
    onPrimary: p["primary-foreground"],
  }
}
