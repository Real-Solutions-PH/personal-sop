// The profile's currency: one row on Finance settings, a sheet to change it.
// Switching relabels every amount; it never converts one (see lib/money).
import {
  CURRENCIES,
  type CurrencyInfo,
  setCurrency,
  useCurrency,
} from "@domain/lib/money"
import { Check, ChevronRight, Coins } from "lucide-react-native"
import { useState } from "react"
import { View } from "react-native"
import { Copy, Line, Tap } from "./native-kit"
import { useTheme } from "./theme"
import { Sheet } from "./ui"

const label = (c: CurrencyInfo) => `${c.name} (${c.code} · ${c.symbol})`

export function CurrencyRow() {
  const t = useTheme(),
    cur = useCurrency(),
    [open, setOpen] = useState(false)
  const pick = (c: CurrencyInfo) => {
    setOpen(false)
    if (c.code === cur.code) return
    setCurrency(c.code)
  }
  return (
    <>
      <Tap onPress={() => setOpen(true)}>
        <Line style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
          <Coins size={20} color={t.muted} />
          <View style={{ flex: 1 }}>
            <Copy weight="medium">Currency</Copy>
            <Copy size={14} muted>
              {label(cur)}
            </Copy>
          </View>
          <ChevronRight size={16} color={t.muted} />
        </Line>
      </Tap>
      <Sheet title="Currency" open={open} onClose={() => setOpen(false)}>
        <Copy size={12} muted>
          Every amount in the app and in Fern's replies uses this. Changing it
          does not convert amounts you already logged.
        </Copy>
        {CURRENCIES.map((c) => (
          <Tap key={c.code} onPress={() => pick(c)} label={label(c)}>
            <Line style={{ paddingVertical: 12, paddingHorizontal: 4 }}>
              <Copy
                weight="medium"
                style={{ width: 52, textAlign: "center", color: t.muted }}
              >
                {c.symbol}
              </Copy>
              <View style={{ flex: 1 }}>
                <Copy weight="medium">{c.name}</Copy>
                <Copy size={12} muted>
                  {c.code}
                </Copy>
              </View>
              {c.code === cur.code && <Check size={18} color={t.fin} />}
            </Line>
          </Tap>
        ))}
      </Sheet>
    </>
  )
}
