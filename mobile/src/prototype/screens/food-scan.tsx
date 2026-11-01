// Scan a packaged food's barcode, look it up in Open Food Facts, set the
// grams eaten (a serving when the label says one) and log it as a meal.
// Not found or offline: say so, with a way to add it by hand.
import { logMeal } from "@domain/fitness/actions"
import { dayKey } from "@domain/lib/day"
import { ScanBarcode } from "lucide-react-native"
import { type ReactNode, useRef, useState } from "react"
import { View } from "react-native"
import { itemFor, lookupBarcode, type Product } from "../food-barcode"
import { Copy, Frame, Line } from "../native-kit"
import { back, go } from "../navigation"
import { Button, Empty, Screen } from "../ui"
import { Input } from "./nutrition-meals"

type Camera = typeof import("expo-camera")
// Loaded on first use: a binary built before the camera module was added
// (reached by an over-the-air update) would crash on import.
let cam: Camera | null | undefined
function loadCamera(): Camera | null {
  if (cam === undefined)
    try {
      cam = require("expo-camera") as Camera
    } catch {
      cam = null
    }
  return cam
}

type State =
  | { at: "scan" }
  | { at: "looking"; code: string }
  | { at: "found"; product: Product }
  | { at: "missing"; code: string }
  | { at: "error"; code: string }

export function FoodScan({ day }: { day?: string }) {
  const c = loadCamera()
  if (!c)
    return (
      <Screen title="Scan a barcode">
        <Empty
          icon={ScanBarcode}
          title="Update Unfurl to scan"
          detail="Barcode scanning needs the latest version of the app."
        />
      </Screen>
    )
  return <Scanner c={c} day={day} />
}

function Scanner({ c, day }: { c: Camera; day?: string }) {
  const [perm, request] = c.useCameraPermissions(),
    [state, setState] = useState<State>({ at: "scan" }),
    // The camera reports the same barcode several times a second, faster
    // than a re-render turns scanning off.
    busy = useRef(false)
  const look = async (code: string) => {
    busy.current = true
    setState({ at: "looking", code })
    const r = await lookupBarcode(code)
    setState(
      r === "error"
        ? { at: "error", code }
        : r
          ? { at: "found", product: r }
          : { at: "missing", code },
    )
  }
  const again = () => {
    busy.current = false
    setState({ at: "scan" })
  }
  const manual = () => go(day ? `/nutrition/new?day=${day}` : "/nutrition/new")
  let body: ReactNode
  if (state.at === "found")
    body = <Found product={state.product} day={day} onAgain={again} />
  else if (state.at === "missing")
    body = (
      <Empty
        icon={ScanBarcode}
        title="Not in the food database yet"
        detail={`Barcode ${state.code} isn't in Open Food Facts. Add it by hand instead.`}
        action={
          <Line style={{ gap: 8 }}>
            <Button tone="quiet" onPress={again}>
              Scan again
            </Button>
            <Button onPress={manual}>Add by hand</Button>
          </Line>
        }
      />
    )
  else if (state.at === "error")
    body = (
      <Empty
        icon={ScanBarcode}
        title="Couldn't look it up"
        detail="Check your connection and try again."
        action={
          <Line style={{ gap: 8 }}>
            <Button tone="quiet" onPress={again}>
              Scan again
            </Button>
            <Button onPress={() => void look(state.code)}>Try again</Button>
          </Line>
        }
      />
    )
  else if (!perm) body = null
  else if (!perm.granted)
    body = (
      <Empty
        icon={ScanBarcode}
        title="Allow the camera to scan"
        detail="Unfurl only reads the barcode; nothing is recorded."
        action={
          perm.canAskAgain ? (
            <Button onPress={() => void request()}>Allow camera</Button>
          ) : (
            <Button tone="quiet" onPress={manual}>
              Add by hand
            </Button>
          )
        }
      />
    )
  else
    body = (
      <View style={{ gap: 12 }}>
        <View
          style={{ height: 320, borderRadius: 16, overflow: "hidden" }}
          accessibilityLabel="Camera, point it at a barcode"
        >
          <c.CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"],
            }}
            onBarcodeScanned={
              state.at === "scan"
                ? ({ data }) => {
                    if (!busy.current) void look(data)
                  }
                : undefined
            }
          />
        </View>
        <Copy size={13} muted style={{ textAlign: "center" }}>
          {state.at === "looking"
            ? "Looking it up…"
            : "Point the camera at the barcode on the pack."}
        </Copy>
      </View>
    )
  return <Screen title="Scan a barcode">{body}</Screen>
}

function Found({
  product: p,
  day,
  onAgain,
}: {
  product: Product
  day?: string
  onAgain: () => void
}) {
  const [grams, setGrams] = useState(String(p.servingG ?? 100)),
    g = Number(grams),
    ok = Number.isFinite(g) && g > 0,
    item = itemFor(p, ok ? g : 0)
  const log = () => {
    logMeal({
      items: [item],
      source: "manual",
      rawInput: `Barcode ${p.code}`,
      // A past day's meal lands at noon that day, like adding by hand.
      ...(day &&
        day !== dayKey() && {
          eatenAt: new Date(`${day}T12:00:00`).toISOString(),
        }),
    })
    back("/nutrition")
  }
  return (
    <Frame style={{ padding: 16, gap: 12 }}>
      <View>
        <Copy weight="semibold">{p.name}</Copy>
        {p.brand && (
          <Copy size={13} muted>
            {p.brand}
          </Copy>
        )}
      </View>
      <View>
        <Copy size={11} muted>
          {p.servingG ? `GRAMS (1 serving = ${p.servingG} g)` : "GRAMS"}
        </Copy>
        <Input
          accessibilityLabel="Grams eaten"
          value={grams}
          onChangeText={setGrams}
          keyboardType="decimal-pad"
          style={{ marginTop: 2 }}
        />
      </View>
      <Copy size={13} muted>
        {`${item.kcal} kcal · P ${item.protein} g · C ${item.carbs} g · F ${item.fat} g`}
      </Copy>
      <Line style={{ gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button tone="quiet" onPress={onAgain}>
            Scan again
          </Button>
        </View>
        <View style={{ flex: 1 }}>
          <Button disabled={!ok} onPress={log}>
            Log it
          </Button>
        </View>
      </Line>
      <Copy size={11} muted>
        Nutrition from Open Food Facts, entered by its contributors.
      </Copy>
    </Frame>
  )
}
