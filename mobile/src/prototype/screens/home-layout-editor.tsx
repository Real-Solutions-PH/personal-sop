import { dashStore } from "@domain/dash/store"
import {
  ChevronRight,
  LayoutList,
  type LucideIcon,
  PowerOff,
  RotateCcw,
} from "lucide-react-native"
import { Platform, View } from "react-native"
import { extrasStore } from "../extras"
import {
  type HomeSection,
  homeSection,
  moveSection,
  resetHomeLayout,
  setSectionShown,
  useHomeLayout,
} from "../home-layout"
import { border, Copy, Frame, Line, Tap } from "../native-kit"
import { go } from "../navigation"
import { ReorderList } from "../reorder-list"
import { Switch } from "../switch"
import { useTheme } from "../theme"
import { Button, confirm, Screen } from "../ui"

/** Home's sections, in Home's order: drag a grip (or Move up / Move down
 * with a screen reader) to move one, switch one off to keep it off Home. */
export function HomeLayoutEditor() {
  const t = useTheme()
  const { ids, hidden } = useHomeLayout()
  const enabled = dashStore.use((s) => s.enabled)
  const extras = extrasStore.use((s) => s)
  const known = ids
    .map(homeSection)
    .filter((x): x is HomeSection => !!x && (!x.web || Platform.OS === "web"))
  const isOff = (x: HomeSection) =>
    (x.module && !enabled[x.module]) || (x.extra && !extras[x.extra])
  const listed = known.filter((x) => !isOff(x))
  const off = known.filter(isOff)
  const keys = listed.map((x) => x.id)
  return (
    <Screen title="Edit Home">
      <Copy size={14} muted style={{ paddingHorizontal: 4 }}>
        Drag a section by its grip to move it. Switch one off to keep it off
        Home; its page and its data stay.
      </Copy>
      <Heading icon={LayoutList}>Sections on Home</Heading>
      <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
        <ReorderList
          keys={keys}
          label={(id) => homeSection(id)?.label ?? id}
          onMove={(id, to) => moveSection(id, to, keys)}
          renderRow={(id, grip) => {
            const x = homeSection(id)
            if (!x) return null
            const on = !hidden.has(id)
            return (
              <Line
                testID={`home-section-${id}`}
                style={{
                  gap: 8,
                  paddingVertical: 8,
                  borderBottomWidth: id === keys.at(-1) ? 0 : 1,
                  borderBottomColor: border(t.line, 0.5),
                }}
              >
                {grip}
                <SectionIcon section={x} dim={!on} />
                <View style={{ flex: 1 }}>
                  <Copy weight="medium" muted={!on}>
                    {x.label}
                  </Copy>
                  {(x.hint || !on) && (
                    <Copy size={12} muted>
                      {on ? x.hint : "Off Home"}
                    </Copy>
                  )}
                </View>
                <Switch
                  compact
                  accent="primary"
                  label={`Show ${x.label} on Home`}
                  value={on}
                  onChange={(v) => setSectionShown(id, v)}
                />
              </Line>
            )
          }}
        />
      </Frame>
      {off.length > 0 && (
        <>
          <Heading icon={PowerOff}>Switched off in Settings</Heading>
          <Frame style={{ paddingHorizontal: 12, paddingVertical: 4 }}>
            <Tap
              label="Open Settings to turn these back on"
              onPress={() => go("/me/settings")}
            >
              {off.map((x, i) => (
                <Line
                  key={x.id}
                  testID={`home-section-off-${x.id}`}
                  style={{
                    gap: 8,
                    paddingVertical: 12,
                    opacity: 0.5,
                    borderBottomWidth: i === off.length - 1 ? 0 : 1,
                    borderBottomColor: border(t.line, 0.5),
                  }}
                >
                  <SectionIcon section={x} dim />
                  <Copy weight="medium" muted style={{ flex: 1 }}>
                    {x.label}
                  </Copy>
                  <ChevronRight size={16} color={t.muted} />
                </Line>
              ))}
            </Tap>
          </Frame>
          <Copy size={12} muted style={{ marginTop: 4, paddingHorizontal: 4 }}>
            These stay off Home until you turn them on in Settings.
          </Copy>
        </>
      )}
      <View style={{ marginTop: 24, alignItems: "flex-start" }}>
        <Button
          tone="quiet"
          icon={RotateCcw}
          onPress={() =>
            confirm(
              "Reset Home?",
              "Every section goes back to its first place and shows again. The order of Your apps resets too.",
              resetHomeLayout,
              "Reset",
            )
          }
        >
          Reset to default
        </Button>
      </View>
    </Screen>
  )
}

function Heading({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: string
}) {
  const t = useTheme()
  return (
    <View
      accessibilityRole="header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginTop: 24,
        marginBottom: 8,
        paddingHorizontal: 4,
      }}
    >
      <Icon size={14} color={t.muted} />
      <Copy size={13} weight="medium" muted>
        {children}
      </Copy>
    </View>
  )
}

function SectionIcon({ section, dim }: { section: HomeSection; dim: boolean }) {
  const t = useTheme()
  const I = section.icon
  const c = dim ? t.muted : t[section.accent]
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: border(c, 0.15),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <I size={16} color={c} />
    </View>
  )
}
