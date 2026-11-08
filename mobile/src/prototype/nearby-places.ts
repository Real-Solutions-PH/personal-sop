// Places near the phone, for saying where a workout happened. Reverse
// geocoding names a street; this asks Photon (komoot's keyless geocoder over
// OpenStreetMap, called from the phone the way weather.ts calls Open-Meteo)
// for the named places around the person: gyms, sports centres, parks and
// courts first, then the shops and buildings a gym often sits inside.
// Nearest first within each group. The data is © OpenStreetMap
// contributors (ODbL), credited where the list is shown. Overpass was tried
// first and answered in 20 s or not at all; Photon answers in about one.
import * as Location from "expo-location"

export interface NearbyPlace {
  /** OpenStreetMap element, "N123". */
  id: string
  name: string
  /** What it is, as a person reads it: "Gym", "Park", "Mall". */
  kind: string
  /** A place people train at (a gym, a court, a park). */
  fitness: boolean
  /** The neighbourhood it is in ("Bonifacio Global City"). */
  area?: string
  distanceM: number
  lat: number
  lon: number
}

export const PHOTON = "https://photon.komoot.io/reverse"
/** How many places the picker offers. */
export const NEARBY_MAX = 8

/** The tags of places people train at. */
const TRAIN: Record<string, string[]> = {
  leisure: [
    "fitness_centre",
    "sports_centre",
    "sports_hall",
    "stadium",
    "track",
    "pitch",
    "swimming_pool",
    "park",
    "fitness_station",
    "garden",
    "playground",
    "recreation_ground",
  ],
  amenity: ["gym", "dojo", "community_centre"],
}
/** Kinds that are a gym in all but name: they lead the list. */
const GYMS = new Set(["Gym", "Dojo", "Sports centre", "Sports hall"])
/** OpenStreetMap keys that are roads and areas, never a place to name. */
const NOT_A_PLACE = new Set([
  "highway",
  "place",
  "boundary",
  "landuse",
  "railway",
])

/** The two lookups for a point: training places up to 500 m out, and any
 * named place within 150 m (the mall or tower a gym is inside). */
export function nearbyUrls(lat: number, lon: number): string[] {
  const at = `lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&lang=en`,
    tags = Object.entries(TRAIN)
      .flatMap(([k, vs]) => vs.map((v) => `&osm_tag=${k}:${v}`))
      .join("")
  return [
    `${PHOTON}?${at}&limit=10&radius=0.5${tags}`,
    `${PHOTON}?${at}&limit=12&radius=0.15`,
  ]
}

/** Metres between two points (haversine). */
export function metres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const r = (d: number) => (d * Math.PI) / 180,
    dLat = r(bLat - aLat),
    dLon = r(bLon - aLon),
    h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const LABEL: Record<string, string> = {
  fitness_centre: "Gym",
  gym: "Gym",
  dojo: "Dojo",
  sports_centre: "Sports centre",
  sports_hall: "Sports hall",
  stadium: "Stadium",
  track: "Track",
  pitch: "Court or field",
  swimming_pool: "Pool",
  park: "Park",
  garden: "Garden",
  playground: "Playground",
  recreation_ground: "Park",
  fitness_station: "Outdoor gym",
  community_centre: "Community centre",
  mall: "Mall",
  atm: "ATM",
}
const human = (v: string) => {
  const s = v.replace(/_/g, " ").trim()
  return s ? s[0].toUpperCase() + s.slice(1) : ""
}
type Tags = Record<string, string | undefined>
/** What a place is, and whether people train there, from its tags. */
export function kindOf(tags: Tags): { kind: string; fitness: boolean } {
  for (const [k, vs] of Object.entries(TRAIN)) {
    const v = tags[k]
    if (v && vs.includes(v))
      return { kind: LABEL[v] ?? human(v), fitness: true }
  }
  if (tags.sport) return { kind: human(tags.sport), fitness: true }
  for (const k of ["shop", "amenity", "tourism", "office", "leisure"]) {
    const v = tags[k]
    if (v && v !== "yes") return { kind: LABEL[v] ?? human(v), fitness: false }
  }
  if (tags.building) return { kind: "Building", fitness: false }
  return { kind: "Place", fitness: false }
}

type Feature = {
  geometry?: { coordinates?: unknown }
  properties?: {
    osm_type?: string
    osm_id?: number
    osm_key?: string
    osm_value?: string
    name?: string
    locality?: string
    district?: string
  }
}
/** The places in Photon replies: named, never a road or an area, one per
 * name (the nearest), gyms first, then nearest first, at most ``max``. */
export function parseNearby(
  replies: unknown[],
  lat: number,
  lon: number,
  max = NEARBY_MAX,
): NearbyPlace[] {
  const byName = new Map<string, NearbyPlace>()
  for (const reply of replies) {
    const feats = (reply as { features?: unknown })?.features
    if (!Array.isArray(feats)) continue
    for (const f of feats as Feature[]) {
      const p = f?.properties ?? {},
        name = (p.name ?? "").replace(/\s+/g, " ").trim(),
        [pLon, pLat] = Array.isArray(f?.geometry?.coordinates)
          ? (f.geometry.coordinates as unknown[])
          : []
      if (
        !name ||
        !p.osm_key ||
        NOT_A_PLACE.has(p.osm_key) ||
        typeof pLat !== "number" ||
        typeof pLon !== "number"
      )
        continue
      const { kind, fitness } = kindOf({ [p.osm_key]: p.osm_value }),
        area = (p.locality ?? p.district ?? "").trim(),
        place: NearbyPlace = {
          id: `${p.osm_type ?? "N"}${p.osm_id ?? 0}`,
          name,
          kind,
          fitness,
          ...(area && area !== name ? { area } : {}),
          distanceM: Math.round(metres(lat, lon, pLat, pLon)),
          lat: pLat,
          lon: pLon,
        },
        key = name.toLowerCase(),
        had = byName.get(key)
      if (
        !had ||
        (place.fitness && !had.fitness) ||
        (place.fitness === had.fitness && place.distanceM < had.distanceM)
      )
        byName.set(key, place)
    }
  }
  // Gyms lead; parks, courts and the buildings around then go by distance,
  // so the mall a gym is inside is not pushed off by a park 300 m away.
  const rank = (x: NearbyPlace) => (GYMS.has(x.kind) ? 0 : 1)
  return [...byName.values()]
    .sort((a, b) => rank(a) - rank(b) || a.distanceM - b.distanceM)
    .slice(0, max)
}

/** "80 m", "1.2 km". */
export function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.max(1, Math.round(m / 10) * 10)} m`
  return `${(Math.round(m / 100) / 10).toFixed(1)} km`
}

export type NearbyResult =
  | { ok: true; places: NearbyPlace[]; lat: number; lon: number }
  | { ok: false; reason: string }

type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** Places near ``lat``/``lon``, or null when neither lookup answered. */
export async function fetchNearby(
  lat: number,
  lon: number,
  fetcher: Fetcher = fetch,
  timeoutMs = 10_000,
): Promise<NearbyPlace[] | null> {
  const replies = await Promise.all(
    nearbyUrls(lat, lon).map(async (url) => {
      const ctl = new AbortController(),
        timer = setTimeout(() => ctl.abort(), timeoutMs)
      try {
        const res = await fetcher(url, {
          headers: { Accept: "application/json" },
          signal: ctl.signal,
        })
        return res.ok ? ((await res.json()) as unknown) : null
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }),
  )
  const answered = replies.filter((r) => r != null)
  return answered.length ? parseNearby(answered, lat, lon) : null
}

/** Asks for location (only now, when the person tapped for it), finds
 * the phone and lists the places around it. */
export async function findNearby(fetcher?: Fetcher): Promise<NearbyResult> {
  const perm = await Location.requestForegroundPermissionsAsync().catch(
    () => null,
  )
  if (perm?.status !== "granted")
    return {
      ok: false,
      reason:
        "Location is off for Unfurl. Type the place, or allow location in Settings.",
    }
  const pos =
    (await Location.getLastKnownPositionAsync({
      maxAge: 120_000,
      requiredAccuracy: 150,
    }).catch(() => null)) ??
    (await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    }).catch(() => null))
  if (!pos)
    return { ok: false, reason: "Couldn't find where you are. Type the place." }
  const { latitude: lat, longitude: lon } = pos.coords
  const places = await fetchNearby(lat, lon, fetcher)
  if (!places)
    return {
      ok: false,
      reason: "Couldn't load nearby places. Check your connection, or type it.",
    }
  return { ok: true, places, lat, lon }
}
