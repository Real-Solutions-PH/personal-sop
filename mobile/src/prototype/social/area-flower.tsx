import { type Facet, useFacets } from "@domain/dash/facets"
import { module as SCR } from "@domain/screen"
import { View } from "react-native"
import { petalsOf, Rosette } from "../brand/rosette"
import { useScreenTimeShown } from "../screens/screen-card"
import { useTheme } from "../theme"

/** The area flower of Stats, read only, for a profile. */
export function AreaFlower({ facets }: { facets: Facet[] }) {
  const t = useTheme()
  return (
    <View
      testID="profile-area-flower"
      style={{ width: "100%", maxWidth: 360, alignSelf: "center" }}
    >
      <Rosette
        petals={petalsOf(facets, (a) => t[a])}
        height={228}
        ink={{
          ink: t.text,
          muted: t.muted,
          good: t.good,
          bad: t.bad,
          mark: t.dark ? t.sprout : t.frond,
          hub: t.card,
        }}
      />
    </View>
  )
}

/** My own flower as my followers see it: the areas I switched off and
 * screen time with nothing recorded are left out, as the server leaves them
 * out of the scorecard it sends them. */
export function MyAreaFlower() {
  const raw = useFacets(30),
    screenOn = useScreenTimeShown(),
    screenRate = SCR.useAreaRate(30)
  const facets = raw.filter(
    (f) =>
      !f.off && (f.module !== "screen" || (screenOn && screenRate !== null)),
  )
  return <AreaFlower facets={facets} />
}
